# crm_sync

Create CRM client interactions from Python.

You write the code that *fetches* your data. This package owns everything after that:
validating it against the live registries, resolving the external client to a CRN, writing
the row in one atomic transaction, proving it will actually render on the dashboard, and
raising an alarm when it won't.

Pure standard library — no third-party dependencies. Python 3.9+.

---

## Install

```
pip install -e backend           # puts `crm_sync` on sys.path; installs nothing else
python -m crm_sync.test          # smoke test: inserts one engagement, checks it, deletes it
```

`backend/requirements.txt` is intentionally empty. Everything tunable lives in
[`crm_sync/config.py`](../config.py): database location, table names, lookup queries, and
the defaults a new engagement is created with.

### Where `SQLITE_DIR` comes from

`SQLITE_DIR` is the folder holding `engagements.sqlite` and `users.sqlite` — the same one
the Next.js app uses. It is resolved in this order:

1. an explicit `load_config(sqlite_dir=...)`
2. a real environment variable
3. a `.env` file

So in a checkout it needs no setup at all: the repo's own `.env` is found automatically. To
override for one run:

```powershell
$env:SQLITE_DIR = "D:\Data\CRM"     # PowerShell
```
```bash
SQLITE_DIR=/path/to/db python -m crm_sync.test    # bash, single command
```

The `.env` search runs nearest-first — `./.env`, then `backend/.env`, then the repo root's —
so a standalone copy of `backend/` can carry its own. Point `CRM_SYNC_DOTENV` at a specific
file to skip the search entirely.

A real environment variable always beats `.env`, and `os.environ` is never mutated: importing
`crm_sync` cannot change configuration for anything else in the process.

---

## Quick start

One function, one row. Validation, client registration, the transaction, and post-write
verification are all internal.

```python
from crm_sync import create_client_engagement

engagement_id = create_client_engagement(
    external_client="Acme Retirement Trust",
    intake_type="serf",                # role token, resolved to the live display name
    project_type="Data Request",
    internal_client="Acme 401k",       # optional; blank when omitted or unregistered
    crn="CRN-000042",                  # optional; only used to register a NEW client
    project_id="PRJ-1042",             # optional; blank => NULL (ad-hoc work often has none)
)
```

* `intake_type` / `project_type` are checked against the live lookup tables. An unknown
  value raises `ValueError` naming it and listing the valid options, and inserts nothing.
* `external_client` is matched against the `clients` registry, case-insensitively.
* `date_started` defaults to today; `date_finished` is blank (NULL).
* `project_id` is a free-text project identifier, blank by default and stored as NULL. It is
  deliberately excluded from the dedupe key, so back-filling one later never creates a
  duplicate interaction.
* `status` is always `"In Progress"`, `team_members` always `[]`, and every other column is
  left blank or NULL.

### How the CRN is decided

The CRN is the external client's identity: primary key of `clients`, the foreign key on
every engagement, and the parent of its `client_models`. So a registered client always keeps
the CRN it is registered under — an upstream job never re-points it.

| `external_client` | `crn` | Result |
|---|---|---|
| already registered | omitted | Its existing CRN is used. |
| already registered | supplied | **Its existing CRN is used.** The supplied CRN is ignored, with a warning in the log. |
| new | supplied | The client is registered with that CRN. If the CRN already belongs to another client, the engagement is filed against *that* client and the new name is discarded (with a `client_name_drift` warning) — the registry's name is what the dashboard displays. |
| new | omitted | The client is registered with a `PENDING-######` placeholder, flagged so the dashboard shows a red "CRN Pending" badge until someone enters the real value. |

A malformed `crn` raises `ValueError` before anything is opened or written. Correcting a
client's CRN is a deliberate act, done in the dashboard, where the rename cascades properly.

---

## Bulk imports: the `CrmSync` engine

When you're importing from a source system and need idempotency across re-runs, per-record
failure isolation, dry runs, or alert routing:

```python
from crm_sync import CrmSync, ClientInteraction

def fetch_records():                       # <-- your code goes here
    yield ClientInteraction(
        client_name="Acme Retirement Trust",
        client_crn="CRN-000042",
        internal_client_name="Acme 401k",
        internal_client_dept="Retirement",
        intake_type="serf",
        project_type="Data Request",
    )

with CrmSync.from_env() as sync:
    summary = sync.run_batch(fetch_records())

raise SystemExit(summary.exit_code)
```

```
python -m crm_sync.tests.example_job --dry-run    # validate against live data, write nothing
python -m crm_sync.tests.example_job              # write for real
```

Exit codes: `0` clean · `1` some records failed · `2` couldn't start · `3` everything failed.

Unlike `create_client_engagement`, the engine runs the full `validate()` matrix: it refuses
a blank internal client or an unmanaged department, records a dedupe key in `crm_sync_keys`,
mirrors new internal clients into the registry, and writes notes to `engagement_notes`.

---

## Interactions arrive unassigned

`team` and `team_members` both default to empty. That is on purpose.

A scheduled job has no basis for deciding who should own a new piece of work. So an interaction
this package creates lands in a **global unassigned inbox**: it is visible to every user,
carries a yellow "Unassigned" badge, and anyone can claim it in one click — which also files it
into the claimer's team. Only set `team`/`team_members` when your job genuinely knows.

Under the hood: `engagements.team IS NULL` is treated as "belongs to no team yet" by the
dashboard's visibility filter, and an empty `team_members` array makes the row claimable by
anyone who can see it.

---

## Why is there no password?

Because there is no network boundary to authenticate across.

This package opens `engagements.sqlite` directly, as a local process with filesystem access to
`SQLITE_DIR`. The security control is the OS permissions on that directory — anyone who can
read the file can read every interaction regardless of what credential we'd ask for. Adding a
password would be theatre.

The trade-off is that we bypass what the app's HTTP route does on the way in. Each item below
is a **silent** failure — the `INSERT` succeeds, nothing errors, and the row is wrong:

| What the HTTP route does | What we do instead |
|---|---|
| `PRAGMA foreign_keys = ON` | Set on every connection. Python's `sqlite3` defaults it **off**, which would let an orphan `client_crn` through and render a blank client name forever. |
| Derives `team` from the caller's JWT | `team` is explicit and validated, or `NULL` (unassigned). A team that doesn't exist is invisible to every non-admin. |
| `emitEngagementChange()` (live SSE refresh) | An in-process Node EventEmitter we can't call. We `POST /api/internal/nudge` instead — see below. |
| `ensureInternalClient()` | Best-effort `INSERT OR IGNORE` into `internal_clients`, so Settings stays in step without a server restart. |
| `logActivity()` → `activity.sqlite` | Not written. Our JSON-lines log is the audit trail. |

---

## The monitoring, and what each check is actually for

Nothing about a successful `INSERT` tells you the interaction is usable. Every validation rule
exists because a specific value produces a specific silent failure.

**Before the write** (`validation.py`) — in strict mode an ERROR aborts the record before a
transaction opens, so a bad record costs nothing:

| Check | Why |
|---|---|
| `status` ∈ `VALID_STATUSES` | Anything else matches neither the open nor the completed bucket. The row sits in the table looking fine and is counted by **no KPI**. |
| `date_started` is `YYYY-MM-DD` | Period filters compare this column as a *string*. A non-ISO value doesn't error, it just filters and sorts wrong. |
| `intake_type` / `project_type` resolve | The app looks up types by `role`, not name. An unrecognized name gets back-filled on the next server restart with `role = NULL` — **permanently** unable to drive a KPI bucket. No admin action fixes it. |
| `internal_client_dept` is managed | Otherwise it renders as an unmanaged grey slice on the department chart. |
| `team` exists (when set) | Non-admins filter on `team = <their own>`. A bogus team makes the row invisible to the whole floor while admins still see it. |
| `client_crn` is well-formed | A malformed CRN becomes a foreign-key orphan. |

**After the commit** (`verify.py`) — re-reads the row through a *fresh, read-only connection*,
using the dashboard's own `LEFT JOIN clients` and team predicate. A fresh connection is the
point: it proves the row is durable and visible to *other processes*, which is what the Next.js
server is. Any failure raises `DashboardVisibilityError` naming the engagement id.

This is the check that matters. It is the difference between "the job reported success" and
"the interaction is on the dashboard."

**Alerting** (`monitoring.py`) — findings at or above `cfg.alert_on` (default: `ERROR`), plus
every raised exception, go to your alert sinks. Console is wired by default:

```python
from crm_sync.utils.monitoring import WebhookAlertSink, CallableAlertSink

sync.add_alert_sink(WebhookAlertSink("https://hooks.slack.com/services/..."))
sync.add_alert_sink(CallableAlertSink(lambda alert: send_email(alert.render())))
```

Set `CRM_SYNC_LOG_DIR` to also get `crm_sync.jsonl` (one JSON object per line, rotated) and
`alerts.log`. Every line carries a `run_id` (this process) and a `correlation_id` (this record),
so one `jq 'select(.correlation_id == "…")'` reconstructs the full story of a single interaction.

---

## Idempotency

Re-running a job never double-inserts. Each write records a `sync_key` in `crm_sync_keys`, a
sidecar table this package owns outright — the Next.js app never reads, writes, or drops it, so
there is no shared schema to migrate.

The default key is a hash of the record's natural business key. `team` and `team_members` are
deliberately **excluded** from it: an interaction filed as unassigned gets claimed by a human,
which sets both, and the next run must still recognise it as the same interaction.

Pass your source system's stable record id whenever you have one — it beats the derived hash:

```python
ClientInteraction(..., dedupe_key="intake-queue:47182")
```

---

## Live refresh (optional)

Rows always appear on the next dashboard fetch. To also refresh tabs that are *already* open,
set `SYNC_NUDGE_SECRET` in both the app's `.env` and this process's environment. After each
write we `POST /api/internal/nudge`, which re-broadcasts the SSE event on our behalf.

Entirely optional and always best-effort: the row is committed before we try, so a failed or
skipped nudge is a warning, never an error.

---

## Concurrency

The Next.js server writes to the same file while this runs. Three things make that safe:

- `PRAGMA busy_timeout = 5000`, matching better-sqlite3, so both processes wait for each other
  by the same amount rather than one failing instantly.
- `isolation_level=None` plus an explicit **`BEGIN IMMEDIATE`**. Python's default implicit
  transaction is *deferred*: it opens as a reader and tries to upgrade on the first write, which
  under WAL fails outright if the server took the write lock in between. `IMMEDIATE` takes the
  lock up front, so there is nothing to upgrade.
- Retry with exponential backoff and jitter around the whole transaction. Safe because the
  transaction is atomic — a retry re-runs the dedupe check against a clean slate.

---

## Files

Three files at the root are the whole surface a user needs. Everything else is internal.

| Module | Responsibility |
|---|---|
| `main.py` | **`create_client_engagement()`** — the entry point |
| `config.py` | Database location, table names, lookup queries, defaults, CRN policy, alert threshold |
| `test.py` | Runnable smoke test: inserts one engagement, checks its defaults, deletes it |
| `core/models.py` | `ClientInteraction` (the batch contract), `Finding`, `WriteResult`, `BatchSummary` |
| `core/exceptions.py` | The `CrmSyncError` hierarchy |
| `db/connection.py` | Pragmas, `BEGIN IMMEDIATE`, lock retry, the `crm_sync_keys` bootstrap |
| `db/registries.py` | Live snapshot of departments / intake types / project types / teams / roster |
| `db/crn.py` | Port of `app/lib/config/crn.ts` |
| `db/clients.py` | Get-or-create the external client, incl. `PENDING-` placeholders |
| `db/writer.py` | The atomic transaction, for the batch engine |
| `db/verify.py` | Post-write "will this render?" assertions |
| `db/batch.py` | Per-record failure isolation, summary, exit codes |
| `db/engine.py` | The `CrmSync` facade for bulk imports |
| `validation/rules.py` | The pre-write matrix; normalizes dates, CRNs, and role tokens |
| `utils/monitoring.py` | JSON-lines logging, alert sinks |
| `utils/nudge.py` | Best-effort SSE nudge |
| `tests/example_job.py` | Copy this to build a batch job |

---

## Values mirrored from the TypeScript side

These are hand-maintained copies. If someone changes the original, change it here too.

| Here | There |
|---|---|
| `config.VALID_STATUSES` | `app/lib/statusHelpers.ts` |
| `config.AD_HOC_CHANNELS` | `app/lib/types/engagements.ts` |
| `config.CrnPolicy` | `app.config.ts` → `crn` |
| `db/crn.py` | `app/lib/config/crn.ts` |
| `db/verify.py` predicates | `app/lib/db/queries.ts` → `buildFilterClause`, `CLIENT_JOIN` |
