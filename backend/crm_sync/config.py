"""
Configuration for crm_sync: where the databases are, what the tables are called, how CRNs
behave, and how loudly to complain.

This is the one file a user is expected to edit. Everything tunable lives here:

  * database location and filenames        -> SQLITE_DIR, CrmConfig.*_db_name
  * table names                            -> TABLE_*
  * the lookup queries backing validation  -> Q_LOAD_*, Q_LOOKUP_*
  * the values a new engagement defaults to -> DEFAULT_STATUS, EMPTY_TEAM_MEMBERS, ...
  * mirrors of TypeScript-side constants   -> VALID_STATUSES, AD_HOC_CHANNELS, CRN_PATTERN

Reads the same `SQLITE_DIR` the Next.js app uses — from the real environment, or from a
`.env` file next to the app (see `_load_dotenv`). Everything else has a default that works
for a local dev box, and can be overridden per-call:

    cfg = load_config(strict=False, log_dir="C:/logs/crm")

What is deliberately NOT here: the INSERT column lists, verify.py's dashboard-shaped
JOIN, connection.py's PRAGMAs, and the CRN sequence algorithm. Those encode schema
semantics rather than preference — turning them into templates would invite edits that
produce a row the dashboard silently cannot render.
"""

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set

from .core.exceptions import ConfigError
from .core.models import Severity

# ---------------------------------------------------------------------------------
# Mirrors of values owned by the TypeScript side. Keep these in sync by hand.
# ---------------------------------------------------------------------------------

#: Mirror of VALID_STATUSES in app/lib/statusHelpers.ts. A status outside this set
#: never matches the dashboard's OPEN/COMPLETED buckets, so the row silently drops
#: out of every KPI while still sitting in the table.
VALID_STATUSES = ("In Progress", "Awaiting Meeting", "Follow Up", "Completed")

#: Mirror of COMPLETED_STATUSES / OPEN_STATUSES in the same file.
COMPLETED_STATUSES = ("Completed", "Follow Up")
OPEN_STATUSES = ("In Progress", "Awaiting Meeting")

#: Mirror of the AdHocChannel union in app/lib/types/engagements.ts.
AD_HOC_CHANNELS = ("In-Person", "Email", "Teams")

#: Mirror of PENDING_CRN_PREFIX in app/lib/config/crn.ts.
PENDING_CRN_PREFIX = "PENDING-"

#: Mirror of the CRN shape enforced by crnConfig().pattern in app/lib/config/crn.ts:
#: 3-32 chars, uppercase alphanumerics and dashes, must start alphanumeric.
CRN_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,31}$")

#: Role tokens the app assigns to its built-in registry rows. Passing one of these as
#: `intake_type` / `project_type` is safer than passing a literal name, because the app
#: resolves role -> current name at query time (intakeNameForRole in intakeTypes.ts) and
#: an admin is free to rename the display name at any moment.
INTAKE_ROLES = ("irq", "serf", "ad_hoc")
PROJECT_TYPE_ROLES = ("pcr",)


# ---------------------------------------------------------------------------------
# Table names. Rename a table in the app, rename it here.
# ---------------------------------------------------------------------------------

# in engagements.sqlite
TABLE_ENGAGEMENTS = "engagements"
TABLE_ENGAGEMENT_NOTES = "engagement_notes"
TABLE_CLIENTS = "clients"
TABLE_CRN_SEQUENCE = "crn_sequence"
TABLE_INTERNAL_CLIENTS = "internal_clients"
TABLE_DEPARTMENTS = "departments"
TABLE_INTAKE_TYPES = "intake_types"
TABLE_PROJECT_TYPES = "project_types"
#: Owned entirely by this package; the Next.js app never touches it.
TABLE_SYNC_KEYS = "crm_sync_keys"

# in users.sqlite
TABLE_TEAMS = "teams"
TABLE_TEAM_MEMBERS = "team_members"


# ---------------------------------------------------------------------------------
# Lookup queries. These read the app's managed lists; validation rejects any value that
# doesn't appear in one of them, so this is where you point crm_sync at a different
# source of truth.
# ---------------------------------------------------------------------------------

Q_LOAD_DEPARTMENTS = f"SELECT name FROM {TABLE_DEPARTMENTS}"
Q_LOAD_INTAKE_TYPES = f"SELECT name, role FROM {TABLE_INTAKE_TYPES}"
Q_LOAD_PROJECT_TYPES = f"SELECT name, role FROM {TABLE_PROJECT_TYPES}"
Q_LOAD_TEAMS = f"SELECT name FROM {TABLE_TEAMS}"
Q_LOAD_ROSTER = f"SELECT display_name, team FROM {TABLE_TEAM_MEMBERS} WHERE status = 'active'"

#: Resolve an internal client to its department. Case-insensitive, matching the
#: `UNIQUE INDEX ... (name COLLATE NOCASE)` the app puts on this table.
Q_LOOKUP_INTERNAL_CLIENT = (
    f"SELECT name, department FROM {TABLE_INTERNAL_CLIENTS} WHERE name = ? COLLATE NOCASE"
)

#: Resolve an external client by name. Case-insensitive, matching the
#: `UNIQUE INDEX ... (name COLLATE NOCASE)` on `clients`. This is the lookup that decides
#: whether a client is already registered, and therefore whose CRN wins.
Q_LOOKUP_CLIENT_BY_NAME = (
    f"SELECT crn, name, crn_pending FROM {TABLE_CLIENTS} WHERE name = ? COLLATE NOCASE"
)


# ---------------------------------------------------------------------------------
# Defaults applied to an engagement created through `create_client_engagement`.
# ---------------------------------------------------------------------------------

#: Must be a member of VALID_STATUSES. Anything else and the row lands in no KPI bucket.
DEFAULT_STATUS = "In Progress"

#: `engagements.team_members` is a JSON array read with json_each() and JSON.parse().
#: The empty value is '[]', NOT '' — an empty string makes json_each() choke on the
#: team-member filter, which is the query behind "show me my interactions".
EMPTY_TEAM_MEMBERS = "[]"

#: When `create_client_engagement` meets an external client that isn't in the registry,
#: register it with a PENDING-###### placeholder CRN rather than refusing the write. The
#: dashboard shows a red "CRN Pending" badge until a human fills in the real value.
#: Set False to raise instead. Only consulted when crn.auto_generate is off.
REGISTER_UNKNOWN_CLIENT_AS_PENDING = True


@dataclass
class CrnPolicy:
    """
    Mirror of `appConfig.crn` in app.config.ts.

    WARNING: this is a hand-maintained copy. app.config.ts is TypeScript and cannot be
    parsed from Python without a dependency. If someone flips `autoGenerate` or changes
    the prefix/pad over there, change it here too — otherwise this package will refuse to
    create clients that the app would have created (or invent CRNs in the wrong shape).
    """

    auto_generate: bool = False
    prefix: str = "CRN-"
    pad: int = 6


@dataclass
class CrmConfig:
    """Everything crm_sync needs to know to run."""

    #: Directory holding engagements.sqlite / users.sqlite / activity.sqlite.
    sqlite_dir: Path

    #: Filenames within `sqlite_dir`. The app hardcodes these; override only if you have
    #: pointed crm_sync at a copy under different names (a scratch database, say).
    engagements_db_name: str = "engagements.sqlite"
    users_db_name: str = "users.sqlite"

    crn: CrnPolicy = field(default_factory=CrnPolicy)

    #: When True (default), ERROR-severity findings abort a record before it is written.
    #: When False, they are logged and alerted but the write proceeds — useful for a
    #: one-off backfill where you accept messy data and will clean it up after.
    strict: bool = True

    #: Re-read every row after commit and assert it will actually render on the dashboard.
    #: Leave this on. It is the only thing standing between a silent schema mismatch and a
    #: department staring at a dashboard that's quietly missing a week of work.
    verify_after_write: bool = True

    #: Severities that trigger an alert sink. Findings below this still hit the log.
    alert_on: Set[Severity] = field(default_factory=lambda: {Severity.ERROR})

    #: Matches better-sqlite3's busy_timeout in app/lib/db/connection.ts, so Python and
    #: Node wait the same amount for each other's write lock.
    busy_timeout_ms: int = 5000

    #: Retries around a whole transaction when SQLite reports "database is locked".
    retry_attempts: int = 5
    retry_base_delay: float = 0.1

    #: Identity stamped onto created_by_id / created_by_name. There is no logged-in user
    #: behind a scheduled job, so we attribute to the bot rather than fake a human.
    bot_user_id: str = "crm_sync"
    bot_display_name: str = "CRM Sync"

    #: Where crm_sync.jsonl and alerts.log are written. None disables file logging.
    log_dir: Optional[Path] = None

    #: Base URL of the running Next.js app, used only for the post-write SSE nudge.
    crm_base_url: str = "http://localhost:3000"
    #: Shared secret for POST /api/internal/nudge. When None the nudge is skipped entirely.
    nudge_secret: Optional[str] = None
    nudge_timeout: float = 3.0

    # -- derived paths -------------------------------------------------------------

    @property
    def engagements_db(self) -> Path:
        return self.sqlite_dir / self.engagements_db_name

    @property
    def users_db(self) -> Path:
        return self.sqlite_dir / self.users_db_name

    def ensure_ready(self) -> None:
        """
        Fail fast, and fail with a message that says what to do about it.

        Called once at startup. Everything here is cheap; nothing here writes.
        """
        if not self.sqlite_dir.is_dir():
            raise ConfigError(
                f"SQLITE_DIR does not exist or is not a directory: {self.sqlite_dir}. "
                f"Set SQLITE_DIR to the same folder the Next.js app uses (see .env)."
            )
        for db in (self.engagements_db, self.users_db):
            if not db.is_file():
                raise ConfigError(
                    f"Database file not found: {db}. Start the app once (npm run dev) or "
                    f"run `npm run seed` to create the schema before syncing into it."
                )
        if self.log_dir is not None:
            try:
                self.log_dir.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise ConfigError(f"Cannot create log_dir {self.log_dir}: {exc}") from exc


# ---------------------------------------------------------------------------------
# .env support
#
# The Next.js app reads its configuration from a `.env` file. crm_sync runs as a separate
# process and gets no such file for free, which used to mean every shell had to export
# SQLITE_DIR by hand before anything would run.
#
# So we read the same file. A real environment variable always wins — `.env` is the
# fallback, never an override — and `os.environ` is never mutated, so importing crm_sync
# cannot change the behavior of anything else in the host process.
# ---------------------------------------------------------------------------------

#: Set this to read a specific file instead of searching. Useful when `backend/` has been
#: copied somewhere with no .env alongside it.
DOTENV_PATH_VAR = "CRM_SYNC_DOTENV"


def _dotenv_candidates() -> List[Path]:
    """
    Where to look for a `.env`, nearest first.

    Nearest-first matters: a `.env` you dropped next to the copied `backend/` folder should
    beat the repo's own, and the current directory should beat both.
    """
    explicit = os.environ.get(DOTENV_PATH_VAR)
    if explicit:
        return [Path(explicit)]

    package_dir = Path(__file__).resolve().parent  # .../backend/crm_sync
    candidates = [
        Path.cwd() / ".env",
        package_dir.parent / ".env",  # backend/.env — for a copied, standalone backend
        package_dir.parent.parent / ".env",  # repo root .env — what the Next.js app uses
    ]

    seen, unique = set(), []
    for path in candidates:
        if path not in seen:
            seen.add(path)
            unique.append(path)
    return unique


def _parse_dotenv(text: str) -> Dict[str, str]:
    """
    Parse `KEY=value` lines. Blank lines and `#` comments are skipped, a leading `export ` is
    tolerated, and matching surrounding quotes are stripped.

    Values are taken **literally** — no backslash escapes, and no stripping of trailing
    `# comments`. Both are deliberate: `SQLITE_DIR=D:\\Data\\CRM` must survive intact, and a
    secret is allowed to contain a `#`. If you need a value with leading or trailing spaces,
    quote it.
    """
    values: Dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()

        key, sep, value = line.partition("=")
        if not sep:
            continue  # not an assignment; ignore rather than guess
        key = key.strip()
        if not key.isidentifier():
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[key] = value
    return values


def _load_dotenv() -> Dict[str, str]:
    """
    Merge every `.env` we can find, nearest-first (an earlier file's key is not overwritten).

    Never raises: a missing, unreadable, or malformed file just contributes nothing. This
    runs on the happy path of every call, and a busted `.env` should surface as the specific
    "SQLITE_DIR is not set" error below, not as a stack trace from the config module.
    """
    values: Dict[str, str] = {}
    for path in _dotenv_candidates():
        try:
            if not path.is_file():
                continue
            text = path.read_text(encoding="utf-8-sig")  # tolerate a BOM
        except OSError:
            continue
        for key, value in _parse_dotenv(text).items():
            values.setdefault(key, value)
    return values


def _env(name: str, dotenv: Dict[str, str]) -> Optional[str]:
    """Read `name` from the real environment, falling back to `.env`. Blank counts as unset."""
    value = os.environ.get(name)
    if value:
        return value
    return dotenv.get(name) or None


def load_config(**overrides) -> CrmConfig:
    """
    Build a `CrmConfig` from the environment, applying any keyword overrides on top.

    Each setting is resolved in this order: an explicit keyword override, then a real
    environment variable, then a `.env` file (see `_load_dotenv`).

    Environment variables (all optional except SQLITE_DIR):
        SQLITE_DIR         — required; folder holding the three .sqlite files.
                             DUCKDB_DIR is honored as a legacy fallback, matching
                             getDbDir() in app/lib/db/connection.ts.
        CRM_SYNC_LOG_DIR   — where to write crm_sync.jsonl / alerts.log.
        CRM_BASE_URL       — base URL of the running app, for the SSE nudge.
        SYNC_NUDGE_SECRET  — shared secret for POST /api/internal/nudge.
        CRM_SYNC_DOTENV    — read this .env file instead of searching for one.

    Raises:
        ConfigError: if SQLITE_DIR is unset, or `sqlite_dir` was not passed explicitly.
    """
    dotenv = _load_dotenv()

    raw_dir = overrides.pop("sqlite_dir", None) or _env("SQLITE_DIR", dotenv) or _env("DUCKDB_DIR", dotenv)
    if not raw_dir:
        searched = ", ".join(str(p) for p in _dotenv_candidates())
        raise ConfigError(
            "SQLITE_DIR is not set. Point it at the folder holding engagements.sqlite "
            "(the same value the Next.js app's .env uses), pass sqlite_dir=... explicitly, "
            f"or put SQLITE_DIR=... in a .env file. Looked for one at: {searched}"
        )

    log_dir = overrides.pop("log_dir", None) or _env("CRM_SYNC_LOG_DIR", dotenv)

    cfg = CrmConfig(
        sqlite_dir=Path(raw_dir).resolve(),
        log_dir=Path(log_dir).resolve() if log_dir else None,
        crm_base_url=(_env("CRM_BASE_URL", dotenv) or "http://localhost:3000").rstrip("/"),
        nudge_secret=_env("SYNC_NUDGE_SECRET", dotenv),
    )
    for key, value in overrides.items():
        if not hasattr(cfg, key):
            raise ConfigError(f"Unknown config option: {key!r}")
        setattr(cfg, key, value)
    return cfg
