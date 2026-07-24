"""
Configuration for portfolio_data: which files, which tables, and how strict to be.

This is the one file a user is expected to edit. Everything tunable lives here:

  * which database file receives uploads   -> PortfolioConfig.portfolio_db_name
  * table names                            -> TABLE_*
  * validation thresholds                  -> weight_tolerance, max_plausible_return
  * how loudly to complain                 -> strict, verify_after_write

Database *location* is not configured here. `SQLITE_DIR` resolution — real environment
variable first, then a nearest-first `.env` search — is already solved by crm_sync, reads
the same file the Next.js app reads, and never mutates `os.environ`. Reimplementing it
would mean two packages in the same process disagreeing about where the data is, so we
call `crm_sync.config.load_config()` and hold its result.

What is deliberately NOT here: the CREATE TABLE statements, the upsert column lists, and
the client_models query. Those encode schema semantics rather than preference, and turning
them into templates would invite an edit that produces rows the dashboard cannot render.
The column lists are not here for a second reason — they are derived by reflection from
the dataclasses in core/models.py, so there is nothing to keep in step.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Set

from crm_sync.config import CrmConfig
from crm_sync.config import load_config as load_crm_config

from .exceptions import ConfigError
from .models import Severity

__all__ = [
    "PortfolioConfig",
    "load_config",
    "TABLE_CHARACTERISTICS",
    "TABLE_PERFORMANCE",
    "TABLE_BREAKDOWNS",
    "TABLE_BENCHMARKS",
    "TABLE_MARKET_SERIES",
    "TABLE_CLIENT_MODELS",
    "SUBJECT_KEY_COLUMNS",
]


# ---------------------------------------------------------------------------------
# Table names.
#
# All five are created and owned outright by this package. The Next.js app's own
# bootstrap (app/lib/db/portfolio.ts) only ever runs CREATE TABLE IF NOT EXISTS against
# the tables it knows about, so extra tables sitting beside them are inert — the same
# reasoning that lets crm_sync own `crm_sync_keys` in engagements.sqlite. There is no
# shared schema to migrate and nothing for the app to trip over.
#
# The `pf_` prefix keeps them visibly ours in a `.tables` listing.
# ---------------------------------------------------------------------------------

TABLE_CHARACTERISTICS = "pf_characteristics"
TABLE_PERFORMANCE = "pf_performance"
TABLE_BREAKDOWNS = "pf_breakdowns"
TABLE_BENCHMARKS = "pf_benchmarks"
TABLE_MARKET_SERIES = "pf_market_series"

#: Read-only, in engagements.sqlite. The source of truth for logged models.
TABLE_CLIENT_MODELS = "client_models"

#: The four columns that identify a row in every pf_* data table.
SUBJECT_KEY_COLUMNS = ("subject_kind", "subject_id", "sleeve", "as_of")


@dataclass
class PortfolioConfig:
    """Everything portfolio_data needs to know to run."""

    #: Resolved crm_sync configuration. Owns `sqlite_dir` and the connection tunables
    #: (busy_timeout_ms, retry_attempts, retry_base_delay) that db/connection.py passes
    #: through to the shared helpers.
    crm: CrmConfig

    #: Filename within `sqlite_dir` that receives uploads. The app hardcodes this name in
    #: app/lib/db/portfolio.ts; override only when pointed at a scratch copy.
    portfolio_db_name: str = "portfolio.sqlite"

    #: When True (default), ERROR findings abort a record before its transaction opens.
    #: When False they are recorded and the write proceeds — for a one-off backfill where
    #: you accept messy data and will clean it up after.
    strict: bool = True

    #: Re-read every row after commit through a fresh connection and assert it will
    #: actually render. Leave this on; it is the difference between "the upload reported
    #: success" and "the numbers are on the dashboard".
    verify_after_write: bool = True

    #: Reject a model-level `as_of` that is not a quarter end. The period dropdown offers
    #: quarter ends and nothing else, so a mid-quarter row is unreachable. Turn this off
    #: only if the dashboard's period selector gains other options.
    quarter_end_only: bool = True

    #: How far a breakdown's weights may stray from 1.0 before it is an error. 0.005 is
    #: half a percentage point — loose enough for rounding in an export, tight enough to
    #: catch a genuinely missing bucket.
    weight_tolerance: float = 0.005

    #: A return, alpha or drawdown larger than this in absolute value is treated as a
    #: percent-vs-fraction mistake (8.4 meaning 8.4%, not 840%). 3.0 allows a legitimate
    #: 300% since-inception return while still catching the common error.
    max_plausible_return: float = 3.0

    #: Severities worth surfacing to the caller in the summary.
    report_on: Set[Severity] = field(default_factory=lambda: {Severity.ERROR, Severity.WARN})

    # -- derived paths -------------------------------------------------------------

    @property
    def sqlite_dir(self) -> Path:
        return self.crm.sqlite_dir

    @property
    def portfolio_db(self) -> Path:
        """The upload target."""
        return self.crm.sqlite_dir / self.portfolio_db_name

    @property
    def engagements_db(self) -> Path:
        """The pull source. Only ever opened read-only by this package."""
        return self.crm.engagements_db

    def ensure_ready(self) -> None:
        """
        Fail fast, and fail with a message that says what to do about it.

        Called once at the top of every entry point. Everything here is cheap and nothing
        here writes.

        Note what this does NOT do: create portfolio.sqlite when it is missing. The app
        opens that file with `allowRecreate: false` precisely because it holds financial
        data — "if unrecoverable, fail loudly so we restore from backup rather than
        silently starting from an empty file". Auto-creating it here would hand the user
        an empty database that looks fine and reconciles against nothing.
        """
        if not self.sqlite_dir.is_dir():
            raise ConfigError(
                f"SQLITE_DIR does not exist or is not a directory: {self.sqlite_dir}. "
                f"Set SQLITE_DIR to the same folder the Next.js app uses (see .env)."
            )
        if not self.engagements_db.is_file():
            raise ConfigError(
                f"Database file not found: {self.engagements_db}. Start the app once "
                f"(npm run dev) or run `npm run seed` to create the schema."
            )
        if not self.portfolio_db.is_file():
            raise ConfigError(
                f"Portfolio database not found: {self.portfolio_db}. It is built from "
                f"client_models by the sync script — run `npm run sync:portfolio` first. "
                f"This package will not create it: the file holds financial data, and an "
                f"empty one that looks healthy is worse than a missing one."
            )


def load_config(**overrides) -> PortfolioConfig:
    """
    Build a `PortfolioConfig` from the environment, applying keyword overrides on top.

    `SQLITE_DIR` (and the `.env` search behind it) is resolved by crm_sync — see
    `crm_sync/config.py`. Pass `sqlite_dir=...` to point somewhere else for one call;
    every other keyword sets a field on `PortfolioConfig`.

    Raises:
        ConfigError: SQLITE_DIR is unset, or an unknown option was passed.
    """
    crm_overrides = {}
    if "sqlite_dir" in overrides:
        crm_overrides["sqlite_dir"] = overrides.pop("sqlite_dir")
    if "crm" in overrides:
        crm = overrides.pop("crm")
    else:
        crm = load_crm_config(**crm_overrides)

    cfg = PortfolioConfig(crm=crm)
    for key, value in overrides.items():
        if not hasattr(cfg, key):
            raise ConfigError(f"Unknown config option: {key!r}")
        setattr(cfg, key, value)
    return cfg


def resolve(cfg: Optional[PortfolioConfig]) -> PortfolioConfig:
    """
    Normalize the `cfg=None` argument every entry point takes, and check readiness once.

    Entry points accept an optional config so a caller can reuse one across many calls
    without re-reading `.env` each time; passing None is the common case.
    """
    resolved = cfg or load_config()
    resolved.ensure_ready()
    return resolved
