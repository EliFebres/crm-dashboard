"""
The write path: one validated `ClientInteraction` in, one durable, verified engagement out.

Sequence, in order:

  1. Validate against the live registries. In strict mode an ERROR aborts here, before any
     transaction is opened, so a bad record costs nothing and leaves nothing behind.
  2. Compute the idempotency key.
  3. Open BEGIN IMMEDIATE, and inside it: check the dedupe key, resolve the client to a CRN
     (creating it if needed), insert the engagement, record the dedupe key, append the note,
     and register the internal client. All or nothing.
  4. Commit.
  5. Re-read the row through a fresh connection and prove it will render on the dashboard.
  6. Nudge the app so open tabs refresh.

Everything from step 3 to step 4 is wrapped in `run_with_retry`, so a `database is locked` from
the Node server holding the write lock retries the whole transaction. That is safe precisely
because it is atomic: a retry re-runs the dedupe check against a clean slate.
"""

import hashlib
import json
import sqlite3
import uuid
from typing import List, Optional, Tuple

from ..config import (
    TABLE_ENGAGEMENT_NOTES,
    TABLE_ENGAGEMENTS,
    TABLE_INTERNAL_CLIENTS,
    TABLE_SYNC_KEYS,
    CrmConfig,
)
from ..core.exceptions import DashboardVisibilityError, ValidationError
from ..core.models import ClientInteraction, Finding, WriteResult, errors
from ..utils import nudge
from ..utils.monitoring import Monitor
from ..validation.rules import validate
from .clients import resolve_or_create_client
from .connection import run_with_retry, write_tx
from .registries import Registries
from .verify import verify_visible

#: The exact column set the app's POST /engagements route writes, plus `filepath`.
#: `external_client` is retired (the client name lives only in the registry) and `portfolio`
#: is superseded by client_models, so both are left NULL — same as the route does.
_INSERT_SQL = f"""
INSERT INTO {TABLE_ENGAGEMENTS} (
  client_crn, internal_client_name, internal_client_dept,
  intake_type, ad_hoc_channel, type, team_members, department,
  date_started, date_finished, status, portfolio_logged, portfolio,
  nna, notes, tickers_mentioned, team, created_by_id, created_by_name,
  linked_from_id, filepath
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


class EngagementWriter:
    """Writes one interaction at a time. Hold one per process; it owns a SQLite connection."""

    def __init__(self, cfg: CrmConfig, conn: sqlite3.Connection, reg: Registries, monitor: Monitor) -> None:
        self.cfg = cfg
        self.conn = conn
        self.reg = reg
        self.monitor = monitor

    # -- idempotency ---------------------------------------------------------------

    @staticmethod
    def _derive_sync_key(n: ClientInteraction, crn: Optional[str]) -> str:
        """
        Hash the record's natural business key.

        `team` and `team_members` are deliberately excluded. An interaction we file as
        unassigned gets claimed by a human — which sets both — and the next run must still
        recognise it as the same interaction rather than importing a duplicate.

        Pass an explicit `dedupe_key` (your source system's record id) whenever you have one.
        This hash is a fallback for sources that don't give you a stable identifier.
        """
        parts = [
            (crn or n.client_crn or n.client_name).upper(),
            n.internal_client_name.lower(),
            n.intake_type,
            n.project_type,
            n.date_started,
        ]
        return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()

    # -- public --------------------------------------------------------------------

    def write(self, interaction: ClientInteraction) -> WriteResult:
        """
        Persist one interaction.

        Returns:
            WriteResult, with `deduped=True` when the record already existed.

        Raises:
            ValidationError: strict mode, and the record has ERROR findings.
            ClientResolutionError: the external client could not be resolved to a CRN.
            DatabaseLockedError / DatabaseError: SQLite refused the write.
            DashboardVisibilityError: it committed, but it won't render correctly.
        """
        correlation_id = uuid.uuid4().hex
        self.monitor.start_record(correlation_id, interaction.describe())

        # ---- 1. validate (no transaction yet) -----------------------------------
        normalized, findings = validate(interaction, self.reg, self.cfg)
        self.monitor.record_findings(correlation_id, findings)

        blocking = errors(findings)
        if blocking and self.cfg.strict:
            raise ValidationError(
                f"{len(blocking)} validation error(s) on {interaction.describe()}",
                findings=blocking,
                correlation_id=correlation_id,
            )

        # ---- 2/3/4. the transaction ---------------------------------------------
        result = run_with_retry(
            lambda: self._write_txn(normalized, correlation_id, findings),
            self.cfg,
            on_retry=lambda attempt, exc: self.monitor.warn(
                f"database locked, retrying (attempt {attempt})",
                correlation_id=correlation_id, error=str(exc),
            ),
        )

        if result.deduped:
            self.monitor.deduped(correlation_id, result.engagement_id or -1)
            return result

        # ---- 5. verify it will actually render ----------------------------------
        if self.cfg.verify_after_write:
            visibility = verify_visible(self.cfg, result.engagement_id)  # type: ignore[arg-type]
            result.findings.extend(visibility)
            self.monitor.record_findings(correlation_id, visibility, engagement_id=result.engagement_id)
            fatal = errors(visibility)
            if fatal:
                # The row is committed. We cannot un-write it, so make absolutely certain a human
                # is told: this is the failure mode where everything reports success and a
                # department quietly loses a week of interactions.
                raise DashboardVisibilityError(
                    f"Engagement #{result.engagement_id} was written but will not appear correctly "
                    f"on the dashboard.",
                    findings=fatal,
                    correlation_id=correlation_id,
                    engagement_id=result.engagement_id,
                )
            result.verified = True

        # ---- 6. nudge open dashboards -------------------------------------------
        reason = nudge.send(self.cfg, "created")
        if reason is None:
            result.nudged = True
        else:
            # Never fatal: the row is committed and will appear on the next fetch regardless.
            self.monitor.warn(reason, correlation_id=correlation_id, engagement_id=result.engagement_id)

        self.monitor.success(correlation_id, result.engagement_id, result.crn, verified=result.verified)  # type: ignore[arg-type]
        return result

    # -- the transaction -----------------------------------------------------------

    def _write_txn(
        self,
        n: ClientInteraction,
        correlation_id: str,
        findings: List[Finding],
    ) -> WriteResult:
        """
        The atomic part. Called under `run_with_retry`, so it may execute more than once —
        which is fine, because a rollback leaves no trace and the dedupe check re-runs.
        """
        with write_tx(self.conn) as cur:
            created_by_id = n.created_by_id or self.cfg.bot_user_id
            created_by_name = n.created_by_name or self.cfg.bot_display_name

            # -- resolve the external client first: we need its CRN for the dedupe key,
            #    and the engagement's foreign key points at it.
            client = resolve_or_create_client(
                cur,
                name=n.client_name,
                cfg=self.cfg,
                crn=n.client_crn,
                pending=n.client_pending,
                created_by_id=created_by_id,
                created_by_name=created_by_name,
            )
            run_findings = list(findings) + client.findings

            # -- idempotency: has this exact interaction already been imported?
            sync_key = n.dedupe_key or self._derive_sync_key(n, client.crn)
            existing = cur.execute(
                f"SELECT engagement_id FROM {TABLE_SYNC_KEYS} WHERE sync_key = ?", (sync_key,)
            ).fetchone()
            if existing:
                return WriteResult(
                    correlation_id=correlation_id,
                    engagement_id=int(existing["engagement_id"]),
                    crn=client.crn,
                    findings=run_findings,
                    deduped=True,
                )

            cur.execute(
                _INSERT_SQL,
                (
                    client.crn,
                    n.internal_client_name,
                    n.internal_client_dept,
                    n.intake_type,
                    n.ad_hoc_channel,
                    n.project_type,
                    json.dumps(n.team_members),
                    n.department,
                    n.date_started,
                    n.date_finished,
                    n.status,
                    1 if n.portfolio_logged else 0,
                    None,  # portfolio: retired in favor of client_models
                    n.nna,
                    None,  # notes: the UI reads engagement_notes, not this legacy column
                    json.dumps(n.tickers_mentioned) if n.tickers_mentioned else None,
                    n.team,  # None => unassigned, visible to everyone, claimable
                    created_by_id,
                    created_by_name,
                    n.linked_from_id,
                    n.filepath,
                ),
            )
            engagement_id = int(cur.lastrowid)

            cur.execute(
                f"INSERT INTO {TABLE_SYNC_KEYS} (sync_key, engagement_id) VALUES (?, ?)",
                (sync_key, engagement_id),
            )

            # -- notes go in the append-only log the UI actually reads. Writing the legacy
            #    engagements.notes column instead would be invisible: the migration that folds
            #    it into engagement_notes only runs at server start, and only for engagements
            #    that have no note rows yet.
            if n.notes and n.notes.strip():
                cur.execute(
                    f"""
                    INSERT INTO {TABLE_ENGAGEMENT_NOTES} (engagement_id, note_text, author_name, author_id)
                    VALUES (?, ?, ?, ?)
                    """,
                    (engagement_id, n.notes.strip(), created_by_name, created_by_id),
                )

            # -- mirror ensureInternalClient(): keep Settings -> Internal Clients in step without
            #    waiting for a server restart to back-fill it. INSERT OR IGNORE respects the
            #    unique-nocase name index, so an existing name is left exactly as it is.
            #
            #    Note what we deliberately do NOT do: back-fill unknown departments, intake types
            #    or project types. We cannot know what `role` they should carry, and a registry row
            #    with role=NULL is broken beyond repair — no restart or admin action restores it.
            #    Validation refuses those instead.
            cur.execute(
                f"""
                INSERT OR IGNORE INTO {TABLE_INTERNAL_CLIENTS} (id, name, department)
                VALUES (lower(hex(randomblob(16))), ?, ?)
                """,
                (n.internal_client_name, n.internal_client_dept),
            )

            return WriteResult(
                correlation_id=correlation_id,
                engagement_id=engagement_id,
                crn=client.crn,
                findings=run_findings,
            )
