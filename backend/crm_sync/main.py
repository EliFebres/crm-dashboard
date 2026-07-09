"""
The public entry point.

    from crm_sync import create_client_engagement

    engagement_id = create_client_engagement(
        external_client="Acme Retirement Trust",
        intake_type="serf",              # role token, or the live display name
        project_type="Data Request",
    )

One function, one row. Validation, client registration, the transaction, and post-write
verification are all internal — a caller never touches `CrmConfig`, `ClientInteraction`,
`Registries`, or any of the machinery under `crm_sync/db/`.

Configuration comes from the environment (`SQLITE_DIR`, at minimum) via `config.load_config`.
See `crm_sync/config.py` for everything that can be tuned.

For bulk imports that need idempotency, per-record failure isolation, dry runs, or alert
routing, use the `CrmSync` engine instead (see `crm_sync/db/engine.py`).
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import date, datetime
from typing import Optional, Tuple

from .config import (
    DEFAULT_STATUS,
    EMPTY_TEAM_MEMBERS,
    Q_LOOKUP_CLIENT_BY_NAME,
    Q_LOOKUP_INTERNAL_CLIENT,
    REGISTER_UNKNOWN_CLIENT_AS_PENDING,
    TABLE_ENGAGEMENTS,
    CrmConfig,
    load_config,
)
from .core.exceptions import DashboardVisibilityError
from .core.models import errors
from .db.clients import ResolvedClient, resolve_or_create_client
from .db.connection import open_engagements, run_with_retry, write_tx
from .db.crn import is_valid_crn, normalize_crn
from .db.registries import Registries
from .db.verify import verify_visible
from .validation.rules import normalize_date

__all__ = ["create_client_engagement"]

_log = logging.getLogger("crm_sync")

#: Only the columns this function has an opinion about. Every other column in `engagements`
#: — ad_hoc_channel, portfolio_logged, portfolio, nna, notes, tickers_mentioned,
#: linked_from_id, team, filepath, and the retired external_client — is left to its schema
#: default (NULL, or 0 for portfolio_logged). `project_id` is NULL unless supplied.
#:
#: `team` stays NULL on purpose: that is the dashboard's unassigned inbox. The row shows up
#: for every user with a yellow "Unassigned" badge and is claimable by whoever picks it up.
#: A scheduled job has no basis for deciding who owns a new piece of work.
_INSERT_SQL = f"""
INSERT INTO {TABLE_ENGAGEMENTS} (
  client_crn, internal_client_name, internal_client_dept,
  intake_type, type, team_members, department,
  date_started, date_finished, status,
  created_by_id, created_by_name, project_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def create_client_engagement(
    external_client: str,
    intake_type: str,
    project_type: str,
    internal_client: str = "",
    date_started: Optional[datetime] = None,
    date_finished: str = "",
    crn: str = "",
    project_id: str = "",
) -> int:
    """
    Create one client engagement and return its new record ID.

    Args:
        external_client: The external client's name. Matched case-insensitively against the
            `clients` registry. If it isn't registered, it is registered for you — with
            `crn` when you supply one, otherwise with a `PENDING-######` placeholder CRN,
            flagged so the dashboard shows a red "CRN Pending" badge until a human supplies
            the real value. (The engagement stores a CRN, not a name —
            `engagements.client_crn` is a foreign key and the dashboard resolves the display
            name by joining through it.)
        intake_type: A role token (``'irq'``, ``'serf'``, ``'ad_hoc'``) or a registered
            intake-type name. Role tokens are safer: they survive an admin renaming the type.
        project_type: A role token (``'pcr'``) or a registered project-type name.
        internal_client: The internal contact. Looked up in the `internal_clients` registry;
            when found, the engagement also inherits that client's department. When blank or
            unregistered, the name and department are both stored blank — this is not an
            error, and nothing is added to the registry.
        date_started: Defaults to today (local date, matching how the dashboard computes its
            period filters). A `datetime` or `date` is stored as its ISO `YYYY-MM-DD` day.
        date_finished: Blank by default, stored as NULL. A completion-date column of `''`
            would satisfy the KPI queries' `date_finished IS NOT NULL` test and report the
            interaction as finished on no date at all.
        crn: The external client's real Client Reference Number, when the upstream system
            knows it. Used only to *register a client that does not exist yet* — an already
            registered `external_client` always keeps the CRN it is registered under, and a
            differing `crn` is ignored with a warning in the log.

            That precedence is deliberate. The CRN is the client's identity: it is the
            primary key of `clients`, the foreign key every engagement points at, and what
            `client_models` cascade from. Re-pointing a known client at a new CRN from a
            batch job would orphan its history. Correcting a CRN is a deliberate act, done
            in the dashboard, where the rename cascades properly.

            Omit it and an unregistered client gets a `PENDING-######` placeholder instead.
        project_id: Optional free-text project identifier. Blank by default, stored as NULL —
            ad-hoc work often has no assigned ID.

    Always inserted, never parameters:
        status — always ``"In Progress"`` (see `config.DEFAULT_STATUS`).
        team_members — always the empty JSON array ``"[]"``.

    Returns:
        The new engagement's `id`.

    Raises:
        ValueError: `external_client` is blank; `intake_type` or `project_type` matches no
            registered value; `date_finished` is unparseable; `crn` is malformed. Nothing is
            inserted — every one of these is checked before a write connection is opened.
        ConfigError: SQLITE_DIR is unset, or a database file is missing.
        DatabaseError / DatabaseLockedError / ForeignKeyError: SQLite refused the write. The
            transaction is atomic, so a failure leaves no partial rows.
        DashboardVisibilityError: the row committed but will not render on the dashboard.
        CrnRequiredError: `external_client` is new, no `crn` was supplied, and placeholder
            registration is disabled (`config.REGISTER_UNKNOWN_CLIENT_AS_PENDING`).

    Note:
        Intake and project types are resolved against a snapshot taken at call time. In the
        narrow window where an admin renames a type between that snapshot and the commit,
        post-write verification catches the stale name and raises.
    """
    # ---- configuration. Fails before anything is opened or written. -------------------
    cfg = load_config()
    cfg.ensure_ready()

    # ---- validate everything we can without touching a write connection --------------
    # Order matters: every check below must happen before `open_engagements`, so that a bad
    # argument costs nothing and leaves nothing behind.
    external_client = (external_client or "").strip()
    if not external_client:
        raise ValueError(
            "external_client is required. The dashboard resolves an interaction's client "
            "name by joining `engagements.client_crn` to the `clients` registry, so an "
            "engagement with no client renders with a blank client, forever."
        )

    reg = Registries.load(cfg)
    intake_name = _resolve_or_raise(
        reg.resolve_intake, intake_type, "intake_type", _known(reg.intake_types), reg.intake_by_role
    )
    type_name = _resolve_or_raise(
        reg.resolve_project_type, project_type, "project_type", _known(reg.project_types), reg.project_type_by_role
    )

    started = _coerce_start_date(date_started)
    finished = _coerce_finish_date(date_finished)
    supplied_crn = _coerce_crn(crn)
    # Blank must land as NULL, not '' — the dashboard's search and export both treat an
    # empty string as a real, searchable value.
    cleaned_project_id = (project_id or "").strip() or None

    # ---- the write. Atomic, and retried as a whole if the Node server holds the lock. --
    conn = open_engagements(cfg)
    try:
        engagement_id, client = run_with_retry(
            lambda: _insert(
                conn, cfg, external_client, supplied_crn, internal_client,
                intake_name, type_name, started, finished, cleaned_project_id,
            ),
            cfg,
        )
    finally:
        conn.close()

    if client.created:
        # The caller only gets an int back, so this is the one place a newly minted CRN
        # surfaces. A placeholder needs a human to fill in the real value.
        _log.info(
            "registered external client %r with %s CRN %s%s",
            external_client,
            "the supplied" if supplied_crn else "placeholder" if client.pending else "auto-generated",
            client.crn,
            " — it shows a 'CRN Pending' badge until the real CRN is entered" if client.pending else "",
        )
    elif supplied_crn and supplied_crn != client.crn:
        # The client was already registered, so its existing CRN wins. Say so loudly enough
        # that a caller feeding a wrong CRN upstream can find out, but do not fail the write:
        # the interaction is filed against the right client either way.
        _log.warning(
            "external client %r is already registered under CRN %s; the supplied CRN %s was "
            "ignored. Correct it in the dashboard if %s is the right identifier.",
            client.name,
            client.crn,
            supplied_crn,
            supplied_crn,
        )

    # Client resolution can report a name drift (the supplied CRN belongs to a client
    # registered under a different name). Nothing else reads these, so log them or they die.
    for finding in client.findings:
        _log.warning("%s", finding)

    # ---- prove it will actually appear on the dashboard -------------------------------
    fatal = errors(verify_visible(cfg, engagement_id))
    if fatal:
        # The row is committed and cannot be un-written. Raising is the only way to make
        # sure a human learns that it landed wrong.
        raise DashboardVisibilityError(
            f"Engagement #{engagement_id} was written but will not appear correctly on the "
            f"dashboard.",
            findings=fatal,
            engagement_id=engagement_id,
        )

    return engagement_id


# -------------------------------------------------------------------------------------
# internals
# -------------------------------------------------------------------------------------


def _insert(
    conn: sqlite3.Connection,
    cfg: CrmConfig,
    external_client: str,
    supplied_crn: str,
    internal_client: str,
    intake_name: str,
    type_name: str,
    started: str,
    finished: Optional[str],
    project_id: Optional[str],
) -> Tuple[int, ResolvedClient]:
    """
    The atomic part: resolve the client, look up the internal client, insert the engagement.

    Runs under `run_with_retry`, so it may execute more than once. That is safe because
    `write_tx` rolls the whole thing back on any exception — a retry starts from a clean
    slate, and a half-written engagement can never survive.
    """
    with write_tx(conn) as cur:
        client = _resolve_client(cur, cfg, external_client, supplied_crn)

        ic_name, ic_dept = _lookup_internal_client(cur, internal_client)

        cur.execute(
            _INSERT_SQL,
            (
                client.crn,
                ic_name,
                ic_dept,
                intake_name,
                type_name,
                EMPTY_TEAM_MEMBERS,
                # The engagement's own `department` mirrors the internal client's, exactly as
                # the app's POST route does (`body.internalClient?.clientDept ?? ...`).
                ic_dept,
                started,
                finished,
                DEFAULT_STATUS,
                cfg.bot_user_id,
                cfg.bot_display_name,
                project_id,
            ),
        )
        return int(cur.lastrowid), client


def _resolve_client(cur: sqlite3.Cursor, cfg: CrmConfig, name: str, supplied_crn: str) -> ResolvedClient:
    """
    Resolve the external client to a CRN, registering it if it is new.

    **A registered name keeps its registered CRN**, whatever `supplied_crn` says. That is why
    this looks the client up by name first, instead of delegating straight to
    `resolve_or_create_client` — which resolves by CRN first, and would either re-point the
    engagement at whichever client owns `supplied_crn` or refuse the write outright.

    The CRN is the client's identity: primary key of `clients`, the foreign key on every
    engagement, and the parent of its `client_models`. An upstream job is not the place to
    change one.

    So, in order:
      1. `name` is registered  -> reuse its CRN. `supplied_crn` is ignored (the caller is
         warned).
      2. `name` is new, `supplied_crn` given -> register the client with it. If that CRN is
         already registered under a different name, the engagement is filed against *that*
         client and `name` is discarded, with a `client_name_drift` warning: the CRN is the
         identity, and the registry's name is what the dashboard displays.
      3. `name` is new, no CRN -> a `PENDING-######` placeholder for a human to fill in
         (or `CrnRequiredError`, if `REGISTER_UNKNOWN_CLIENT_AS_PENDING` is off).

    Must be called inside an open transaction: the read-then-insert in cases 2 and 3 is only
    atomic because the write lock is already held.
    """
    existing = cur.execute(Q_LOOKUP_CLIENT_BY_NAME, (name,)).fetchone()
    if existing:
        return ResolvedClient(
            crn=existing["crn"],
            name=existing["name"],
            pending=bool(existing["crn_pending"]),
        )

    return resolve_or_create_client(
        cur,
        name=name,
        cfg=cfg,
        crn=supplied_crn or None,
        # Only meaningful on the no-CRN path; a supplied CRN is the real one, not a placeholder.
        pending=REGISTER_UNKNOWN_CLIENT_AS_PENDING and not supplied_crn,
        created_by_id=cfg.bot_user_id,
        created_by_name=cfg.bot_display_name,
    )


def _lookup_internal_client(cur: sqlite3.Cursor, name: str) -> Tuple[str, str]:
    """
    Resolve an internal client to `(canonical_name, department)`, or `("", "")`.

    A blank or unregistered name is not an error — it yields blanks and the engagement is
    written without an internal client. Deliberately never inserts: the app's own registry
    seed skips blank names, and a `('', '')` row would show up as an empty entry in
    Settings -> Internal Clients that nobody can explain.
    """
    name = (name or "").strip()
    if not name:
        return ("", "")

    row = cur.execute(Q_LOOKUP_INTERNAL_CLIENT, (name,)).fetchone()
    if row is None:
        return ("", "")
    return (row["name"], row["department"])


def _resolve_or_raise(resolver, value: str, field: str, known: str, roles: dict) -> str:
    """
    Resolve a role token or display name to its canonical name, or raise `ValueError`.

    Refusing here rather than writing the caller's string verbatim is the whole point: an
    unregistered type name is back-filled with `role = NULL` on the next server restart, and
    a type with no role can never drive a KPI bucket again. No restart, and no admin action
    in Settings, restores it.
    """
    resolved = resolver((value or "").strip()) if value else None
    if resolved is None:
        hint = f" Role tokens: {', '.join(sorted(roles))}." if roles else ""
        raise ValueError(
            f"{field}={value!r} is not a valid {field.replace('_', ' ')}. "
            f"Valid options: {known}.{hint}"
        )
    return resolved[0]


def _known(registry: dict) -> str:
    """Comma-separated canonical names from a `{lowered: (name, role)}` registry map."""
    return ", ".join(sorted(entry[0] for entry in registry.values()))


def _coerce_crn(value: str) -> str:
    """
    Normalize a supplied CRN, or return `""` when none was given.

    Trimmed and uppercased, because `clients.crn` is a case-sensitive TEXT PRIMARY KEY that
    only ever holds normalized values — so normalizing here is what lets 'crn-42' find
    'CRN-42' instead of registering a second client alongside it.

    A malformed CRN raises before any connection is opened. Storing one would create a client
    the dashboard's own CRN validation can never edit.
    """
    if not value or not str(value).strip():
        return ""
    normalized = normalize_crn(str(value))
    if not is_valid_crn(normalized):
        raise ValueError(
            f"crn={value!r} is not a valid CRN. Expected 3-32 uppercase alphanumerics and "
            f"dashes, starting with an alphanumeric (e.g. 'CRN-000042'). Leave it blank to "
            f"register the client with a PENDING placeholder instead."
        )
    return normalized


def _coerce_start_date(value: Optional[datetime]) -> str:
    """
    Normalize `date_started` to `YYYY-MM-DD`, defaulting to *local* today.

    Local, not UTC: the app derives period filters and the contribution heatmap from local
    dates (`localTodayISO` in dateUtils.ts), so a UTC "today" would shift a late-evening run
    onto tomorrow and drop the interaction out of this week's numbers.
    """
    if value is None:
        return date.today().isoformat()
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    raise ValueError(f"date_started must be a datetime, a date, or None; got {type(value).__name__}.")


def _coerce_finish_date(value: str) -> Optional[str]:
    """
    Normalize `date_finished` to `YYYY-MM-DD`, or None when blank.

    None, not `''`. The KPI queries select finished work with `date_finished IS NOT NULL`
    (kpi-aggregations.ts), so an empty string would count this interaction as completed on
    no date at all — and nothing else in the stack would ever complain.

    Garbage raises rather than being stored verbatim. Post-write verification only checks
    `date_started`, so a malformed finish date is exactly the kind of write that succeeds
    everywhere and quietly corrupts the completion heatmap.
    """
    if not value or not str(value).strip():
        return None
    normalized = normalize_date(str(value))
    if normalized is None:
        raise ValueError(
            f"date_finished={value!r} could not be parsed. Expected 'YYYY-MM-DD' or a display "
            f"date like 'Jan 15, 2025'. Leave it blank for an unfinished interaction."
        )
    return normalized
