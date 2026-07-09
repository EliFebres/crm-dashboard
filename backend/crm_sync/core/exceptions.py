"""
Exception hierarchy for crm_sync.

Every exception carries the `findings` that explain it and the `correlation_id` of the
record being processed, so an alert sink or a log line has full context without the
caller having to stitch anything back together.

Catch `CrmSyncError` to handle "this record failed" generically — that is exactly what
`BatchRunner` does, so one bad record never aborts a run. Anything that is *not* a
`CrmSyncError` (a `KeyError` in your fetch code, say) is a bug and is allowed to escape.
"""

from typing import List, Optional

from .models import Finding


class CrmSyncError(Exception):
    """Base class. Every failure this package raises on purpose is one of these."""

    def __init__(
        self,
        message: str,
        findings: Optional[List[Finding]] = None,
        correlation_id: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.findings: List[Finding] = findings or []
        self.correlation_id = correlation_id

    def __str__(self) -> str:
        if not self.findings:
            return self.message
        detail = "; ".join(str(f) for f in self.findings)
        return f"{self.message} -> {detail}"


class ConfigError(CrmSyncError):
    """SQLITE_DIR unset, a database file missing, an unwritable log directory."""


class ValidationError(CrmSyncError):
    """
    Strict-mode validation produced ERROR findings. Raised *before* any transaction is
    opened, so nothing was written and nothing needs undoing.
    """


class ClientResolutionError(CrmSyncError):
    """Base for failures resolving the external client to a CRN."""


class CrnRequiredError(ClientResolutionError):
    """
    A new client was named but no CRN was supplied, and CRN auto-generation is off
    (`app.config.ts` -> crn.autoGenerate). Pass `client_crn=...`, or `client_pending=True`
    to register a PENDING-###### placeholder that a human fills in later.
    """


class InvalidCrnError(ClientResolutionError):
    """The supplied CRN doesn't match the configured format."""


class ClientConflictError(ClientResolutionError):
    """
    The client registry's uniqueness rules reject this pairing — the name is already
    registered under a different CRN, or the CRN already belongs to a different name.
    Mirrors the 409 the app's own /clients route returns.
    """


class DatabaseError(CrmSyncError):
    """Base for SQLite-level failures."""


class DatabaseLockedError(DatabaseError):
    """
    SQLite stayed busy through every retry. The Next.js server holds the write lock during
    its own transactions; normally `busy_timeout` absorbs that. Seeing this means sustained
    contention (or a stuck writer holding a transaction open).
    """


class ForeignKeyError(DatabaseError):
    """
    A foreign key constraint failed — almost always `engagements.client_crn` pointing at a
    CRN with no row in `clients`. Should be unreachable: we enable `PRAGMA foreign_keys`
    and resolve the client inside the same transaction.
    """


class DashboardVisibilityError(CrmSyncError):
    """
    The row committed, but post-write verification says it will not show up correctly on
    the dashboard.

    This is the loud one. The insert "succeeded" and every other system would report green.
    The row exists and is wrong: an unresolvable client name, a team nobody belongs to, a
    status outside the KPI buckets. The engagement id is on `.engagement_id` so an operator
    can go look at, fix, or delete it.
    """

    def __init__(
        self,
        message: str,
        findings: Optional[List[Finding]] = None,
        correlation_id: Optional[str] = None,
        engagement_id: Optional[int] = None,
    ) -> None:
        super().__init__(message, findings, correlation_id)
        self.engagement_id = engagement_id
