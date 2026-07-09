"""
The batch engine: the general-purpose facade for writing many interactions.

This is the *advanced* entry point. For a single client engagement, call
`crm_sync.create_client_engagement()` instead — it needs no setup and no knowledge of the
types in this module.

Reach for `CrmSync` when you are importing from a source system and need what a one-shot
insert cannot give you: idempotency across re-runs, per-record failure isolation over a
whole batch, dry-run validation, and alert sinks that route ERROR findings somewhere a
human watches.

    with CrmSync.from_env() as sync:
        summary = sync.run_batch(fetch_records())
    sys.exit(summary.exit_code)
"""

from typing import Iterable, List, Optional

from ..config import CrmConfig, load_config
from ..core.models import BatchSummary, ClientInteraction, WriteResult
from ..utils.monitoring import AlertSink, Monitor
from .batch import BatchRunner, preflight
from .connection import bootstrap_sync_tables, open_engagements
from .registries import Registries
from .writer import EngagementWriter


class CrmSync:
    """
    Opens the database, loads the registries, wires up monitoring, and hands you
    `write_one` / `run_batch`.

    Construct it once per process and reuse it — it holds a SQLite connection and a snapshot
    of the managed lookup tables.

    Use it as a context manager (or call `.close()`) so the connection is released promptly::

        with CrmSync.from_env() as sync:
            summary = sync.run_batch(fetch_records())
    """

    def __init__(self, cfg: CrmConfig, sinks: Optional[List[AlertSink]] = None) -> None:
        cfg.ensure_ready()
        self.cfg = cfg
        self.monitor = Monitor(cfg, sinks)
        self.conn = open_engagements(cfg)
        # Idempotent; creates the Python-owned crm_sync_keys sidecar table if absent.
        bootstrap_sync_tables(self.conn, cfg)
        self.registries = Registries.load(cfg)
        self.writer = EngagementWriter(cfg, self.conn, self.registries, self.monitor)
        self.batch = BatchRunner(self.writer, self.monitor)

    @classmethod
    def from_env(cls, sinks: Optional[List[AlertSink]] = None, **overrides) -> "CrmSync":
        """
        Build from environment variables (SQLITE_DIR, CRM_SYNC_LOG_DIR, CRM_BASE_URL,
        SYNC_NUDGE_SECRET), with keyword overrides applied on top.

        Raises:
            ConfigError: SQLITE_DIR unset, or a database file is missing.
        """
        return cls(load_config(**overrides), sinks)

    def add_alert_sink(self, sink: AlertSink) -> None:
        """Route alerts somewhere your team actually watches. Console is wired by default."""
        self.monitor.add_alert_sink(sink)

    def write_one(self, interaction: ClientInteraction) -> WriteResult:
        """Write a single interaction. Raises `CrmSyncError` subclasses on failure."""
        return self.writer.write(interaction)

    def run_batch(self, records: Iterable[ClientInteraction], *, print_summary: bool = True) -> BatchSummary:
        """Write many interactions. A failing record is recorded, not raised — check the summary."""
        return self.batch.run(records, print_summary=print_summary)

    def dry_run(self, records: Iterable[ClientInteraction]) -> BatchSummary:
        """Validate every record against the live registries and write nothing."""
        return preflight(self.monitor, self.writer, records)

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "CrmSync":
        return self

    def __exit__(self, *exc_info) -> None:
        self.close()
