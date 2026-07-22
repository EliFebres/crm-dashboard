"""
Data shapes exchanged across the crm_sync boundary.

`ClientInteraction` is the contract your automation implements: build one of these
from whatever source you're pulling (a spreadsheet, an internal API, a mailbox) and
hand it to `CrmSync.write_one` / `CrmSync.run_batch`. Everything else in this module
is what comes back out — findings, per-record results, and the batch summary.

This module intentionally imports nothing from the rest of the package, so it can be
imported from `exceptions.py` without a cycle.
"""

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional


class Severity(str, Enum):
    """
    How badly a `Finding` should be treated.

    ERROR — in strict mode this aborts the write before a transaction is opened, and
            always fires an alert. Something about this record would land wrong.
    WARN  — the write proceeds, but a human should look. Logged, and alertable.
    INFO  — expected, notable, non-actionable. e.g. "this record is unassigned".
    """

    ERROR = "ERROR"
    WARN = "WARN"
    INFO = "INFO"


@dataclass(frozen=True)
class Finding:
    """
    One observation about a record, produced by validation or post-write verification.

    `code` is a stable machine-readable slug (e.g. "status_not_valid"). Alert routing
    and log queries should key on `code`, never on `message`, which is free text meant
    for humans and may be reworded.
    """

    field: str
    code: str
    severity: Severity
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "field": self.field,
            "code": self.code,
            "severity": self.severity.value,
            "message": self.message,
        }

    def __str__(self) -> str:
        return f"[{self.severity.value}] {self.field}: {self.message} ({self.code})"


def errors(findings: List[Finding]) -> List[Finding]:
    """Filter helper — the ERROR-severity subset, in original order."""
    return [f for f in findings if f.severity is Severity.ERROR]


@dataclass
class ClientInteraction:
    """
    One client interaction (an "engagement", in the database's own vocabulary) to create.

    Only five fields are required. Everything else has a default that matches how the
    dashboard's own create form behaves, so the minimum viable record is::

        ClientInteraction(
            client_name="Acme Retirement Trust",
            internal_client_name="Acme 401k",
            internal_client_dept="Retirement",
            intake_type="serf",
            project_type="Data Request",
        )

    Ownership is deliberately NOT required. `team=None` + `team_members=[]` produces an
    *unassigned* interaction: it shows up for every user with a yellow "Unassigned" badge,
    and whoever picks it up claims it (which also moves it into their team). That is the
    intended shape for automation — a scheduled job has no basis for deciding who owns a
    new piece of work.

    Attributes:
        client_name: External client's canonical name. Matched case-insensitively against
            the `clients` registry; created there if absent (see `client_crn` / `client_pending`).
        internal_client_name: The internal contact / relationship owner. Required (NOT NULL).
        internal_client_dept: Their department. Must already exist in the managed
            `departments` registry — we cannot invent one safely.
        intake_type: Either a live intake-type name ("IRQ") or, preferably, a stable role
            token: ``'irq'``, ``'serf'``, ``'ad_hoc'``. Role tokens survive an admin renaming
            the type; hardcoded names silently fall out of every KPI bucket when that happens.
        project_type: Same deal, for the `type` column. Role token: ``'pcr'``.
        team: Owning team, or None for unassigned. When set, must name a real row in
            `users.sqlite`.`teams` — a bogus team is invisible to everyone.
        team_members: Assignee display names (e.g. "Alex M."), or empty for unassigned.
            Each must be an active `team_members.display_name`.
        client_crn: Bind this interaction to an exact, already-known CRN. When the CRN is
            unknown to the registry it is created with `client_name`.
        client_pending: Register the client with a system-generated ``PENDING-000001``
            placeholder CRN, flagged so the UI prompts a human for the real value. Only
            meaningful when CRN auto-generation is off (which it is, by default).
        ad_hoc_channel: 'In-Person' | 'Email' | 'Teams'. Only meaningful when `intake_type`
            resolves to the ``ad_hoc`` role.
        department: The engagement's own department column. Defaults to `internal_client_dept`,
            which is what the app's create route does.
        status: One of VALID_STATUSES. A value outside that set makes the row vanish from
            every KPI bucket, so it is always a hard error.
        date_started: 'YYYY-MM-DD', or a display date like 'Jan 15, 2025'. Normalized before
            writing. Defaults to today (local time, matching the app).
        date_finished: Same formats, or None while in progress.
        nna: Net New Assets, in whole dollars.
        portfolio_logged: Whether a portfolio was captured for this interaction.
        tickers_mentioned: Tickers discussed. Feeds the Ticker Trends dashboard.
        linked_from_id: Parent engagement this one followed from (drives funnel KPIs).
        filepath: Path to the project's source folder on disk.
        notes: Free text. Written as an authored entry in `engagement_notes` — NOT into the
            legacy `engagements.notes` column, which the UI no longer reads.
        created_by_id: Attribution. Defaults to the configured bot identity.
        created_by_name: Display name for attribution. Defaults to the configured bot name.
        dedupe_key: Idempotency key. When omitted, a hash of the record's natural business
            key is used. Pass your source system's record id whenever you have one — it is
            strictly more reliable than the derived hash.
    """

    # --- required ---
    client_name: str
    internal_client_name: str
    internal_client_dept: str
    intake_type: str
    project_type: str

    # --- ownership: both default to "unassigned" ---
    team: Optional[str] = None
    team_members: List[str] = field(default_factory=list)

    # --- external client resolution ---
    client_crn: Optional[str] = None
    client_pending: bool = False

    # --- classification ---
    ad_hoc_channel: Optional[str] = None
    department: Optional[str] = None

    # --- lifecycle ---
    status: str = "In Progress"
    date_started: str = ""
    date_finished: Optional[str] = None

    # --- optional payload ---
    nna: Optional[int] = None
    portfolio_logged: bool = False
    tickers_mentioned: Optional[List[str]] = None
    linked_from_id: Optional[int] = None
    filepath: Optional[str] = None
    notes: Optional[str] = None
    #: Free-text project identifier. Blank/None for ad-hoc work with no assigned ID.
    #: Deliberately excluded from the dedupe key — back-filling it later must not
    #: create a duplicate interaction.
    project_id: Optional[str] = None

    # --- attribution + idempotency ---
    created_by_id: Optional[str] = None
    created_by_name: Optional[str] = None
    dedupe_key: Optional[str] = None

    def __post_init__(self) -> None:
        # Default the start date to *local* today. The app computes period filters and
        # the contribution heatmap from local dates (see localTodayISO in dateUtils.ts);
        # using UTC here would shift a late-evening run onto tomorrow.
        if not self.date_started:
            self.date_started = date.today().isoformat()

    def describe(self) -> str:
        """Short human label for logs and alerts. Never includes the full record."""
        return f"{self.client_name} / {self.internal_client_name} / {self.project_type} @ {self.date_started}"


@dataclass
class WriteResult:
    """Outcome of a single `EngagementWriter.write` call."""

    correlation_id: str
    engagement_id: Optional[int] = None
    crn: Optional[str] = None
    findings: List[Finding] = field(default_factory=list)
    #: True when post-write verification confirmed the row is visible on the dashboard.
    verified: bool = False
    #: True when this record already existed (matched on dedupe key) and nothing was written.
    deduped: bool = False
    #: True when the SSE nudge succeeded. False just means open tabs refresh a bit later.
    nudged: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "correlation_id": self.correlation_id,
            "engagement_id": self.engagement_id,
            "crn": self.crn,
            "verified": self.verified,
            "deduped": self.deduped,
            "nudged": self.nudged,
            "findings": [f.to_dict() for f in self.findings],
        }


# Process exit codes. Chosen so a scheduler (cron, Windows Task Scheduler) can alert on
# non-zero and distinguish "couldn't even start" from "ran but some records failed".
EXIT_OK = 0
EXIT_PARTIAL_FAILURE = 1
EXIT_STARTUP_FAILURE = 2
EXIT_TOTAL_FAILURE = 3


@dataclass
class BatchSummary:
    """Aggregate outcome of a `BatchRunner.run` over many records."""

    total: int = 0
    written: int = 0
    deduped: int = 0
    failed: int = 0
    #: correlation_id -> the exception string that killed that record.
    failures: Dict[str, str] = field(default_factory=dict)
    finding_counts: Dict[str, int] = field(default_factory=dict)

    @property
    def exit_code(self) -> int:
        if self.total == 0:
            return EXIT_OK
        if self.failed == 0:
            return EXIT_OK
        if self.failed == self.total:
            return EXIT_TOTAL_FAILURE
        return EXIT_PARTIAL_FAILURE

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total": self.total,
            "written": self.written,
            "deduped": self.deduped,
            "failed": self.failed,
            "failures": self.failures,
            "finding_counts": self.finding_counts,
            "exit_code": self.exit_code,
        }

    def render(self) -> str:
        """Multi-line human summary, printed at the end of a batch run."""
        lines = [
            "=" * 66,
            "crm_sync batch summary",
            "=" * 66,
            f"  records seen : {self.total}",
            f"  written      : {self.written}",
            f"  deduped      : {self.deduped}  (already present, skipped)",
            f"  failed       : {self.failed}",
        ]
        if self.finding_counts:
            counts = ", ".join(f"{k}={v}" for k, v in sorted(self.finding_counts.items()))
            lines.append(f"  findings     : {counts}")
        if self.failures:
            lines.append("  failures:")
            for cid, msg in self.failures.items():
                lines.append(f"    - {cid}: {msg}")
        lines.append(f"  exit code    : {self.exit_code}")
        lines.append("=" * 66)
        return "\n".join(lines)
