"""
crm_sync — create CRM client interactions from Python.

The whole package in one call:

    from crm_sync import create_client_engagement

    engagement_id = create_client_engagement(
        external_client="Acme Retirement Trust",
        intake_type="serf",
        project_type="Data Request",
    )

That validates the intake and project types against the live lookup tables, registers the
external client if it's new, writes the row in one atomic transaction, and proves the result
will actually render on the dashboard before returning. See `main.py`.

Interactions land *unassigned*: no team, no assignees. They appear for every user with a
yellow "Unassigned" badge, and whoever picks one up claims it. That is deliberate — a
scheduled job has no way to know who should own a new piece of work.

For bulk imports, the `CrmSync` engine adds idempotency, per-record failure isolation, dry
runs, and alert sinks:

    from crm_sync import CrmSync, ClientInteraction

    with CrmSync.from_env() as sync:
        summary = sync.run_batch(fetch_records())
    sys.exit(summary.exit_code)

Everything is configured in `crm_sync/config.py` and by `SQLITE_DIR`. Why is there no
password? Because there is no network boundary to authenticate across. This package opens
the SQLite file directly, so the security control is filesystem permissions on SQLITE_DIR,
not an application credential. See docs/README.md.

Internals live under `core/`, `db/`, `validation/`, and `utils/`. They are importable, but
they are not the supported surface: `create_client_engagement` is.
"""

from .config import (
    AD_HOC_CHANNELS,
    COMPLETED_STATUSES,
    OPEN_STATUSES,
    VALID_STATUSES,
    CrmConfig,
    CrnPolicy,
    load_config,
)
from .core.exceptions import (
    ClientConflictError,
    ClientResolutionError,
    ConfigError,
    CrmSyncError,
    CrnRequiredError,
    DashboardVisibilityError,
    DatabaseError,
    DatabaseLockedError,
    ForeignKeyError,
    InvalidCrnError,
    ValidationError,
)
from .core.models import (
    EXIT_OK,
    EXIT_PARTIAL_FAILURE,
    EXIT_STARTUP_FAILURE,
    EXIT_TOTAL_FAILURE,
    BatchSummary,
    ClientInteraction,
    Finding,
    Severity,
    WriteResult,
)
from .db.engine import CrmSync
from .main import create_client_engagement

__version__ = "2.0.0"

__all__ = [
    # the entry point
    "create_client_engagement",
    # the batch engine, for bulk imports
    "CrmSync",
    "ClientInteraction",
    "WriteResult",
    "BatchSummary",
    "Finding",
    "Severity",
    "EXIT_OK",
    "EXIT_PARTIAL_FAILURE",
    "EXIT_STARTUP_FAILURE",
    "EXIT_TOTAL_FAILURE",
    # configuration
    "CrmConfig",
    "CrnPolicy",
    "load_config",
    "VALID_STATUSES",
    "OPEN_STATUSES",
    "COMPLETED_STATUSES",
    "AD_HOC_CHANNELS",
    # exceptions
    "CrmSyncError",
    "ConfigError",
    "ValidationError",
    "ClientResolutionError",
    "CrnRequiredError",
    "InvalidCrnError",
    "ClientConflictError",
    "DatabaseError",
    "DatabaseLockedError",
    "ForeignKeyError",
    "DashboardVisibilityError",
]
