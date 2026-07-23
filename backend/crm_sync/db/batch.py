"""
Batch execution.

The unit of failure is one record, not the run. A nightly job that pulls 400 interactions and
aborts on the third because someone typed a department name wrong is worse than useless — it
looks like it worked (exit 0 never came, but nobody watches that) and it silently drops 397
good records.

So: every record is attempted, every failure is captured with its correlation id, and the
process exit code tells a scheduler what happened.
"""

import sys
from typing import Iterable, Optional

from ..core.exceptions import CrmSyncError
from ..core.models import BatchSummary, ClientInteraction
from ..utils.monitoring import Monitor
from .writer import EngagementWriter


class BatchRunner:
    """Feeds an iterable of interactions through an `EngagementWriter`, tallying outcomes."""

    def __init__(self, writer: EngagementWriter, monitor: Monitor) -> None:
        self.writer = writer
        self.monitor = monitor

    def run(self, records: Iterable[ClientInteraction], *, print_summary: bool = True) -> BatchSummary:
        """
        Write every record. Never raises for a per-record failure.

        `records` may be a generator, so the caller's fetch code can stream rather than
        materialize everything up front. An exception raised *by the generator itself* is a bug
        in the fetch code and is allowed to escape — we only absorb `CrmSyncError`.
        """
        summary = BatchSummary()

        for record in records:
            summary.total += 1
            try:
                result = self.writer.write(record)
            except CrmSyncError as exc:
                summary.failed += 1
                cid = exc.correlation_id or f"record-{summary.total}"
                summary.failures[cid] = str(exc)
                self.monitor.failure(cid, exc, engagement_id=getattr(exc, "engagement_id", None))
            else:
                if result.deduped:
                    summary.deduped += 1
                else:
                    summary.written += 1

        summary.finding_counts = dict(self.monitor.finding_counts)
        self.monitor.info(
            "run finished",
            event="finished",
            **{k: v for k, v in summary.to_dict().items() if k != "failures"},
        )

        if print_summary:
            print(summary.render(), file=sys.stderr)

        return summary


def run_and_exit(summary: BatchSummary) -> None:
    """Convenience for `if __name__ == '__main__'` — exit with the summary's code."""
    sys.exit(summary.exit_code)


def preflight(monitor: Monitor, writer: EngagementWriter, records: Iterable[ClientInteraction]) -> BatchSummary:
    """
    Validate every record and write nothing.

    Use this from a `--dry-run` flag to prove a job's records are clean against the *live*
    registries before letting it near the database. Findings are logged and alerted exactly as
    they would be during a real run.
    """
    from ..core.models import errors as _errors
    from ..validation.rules import validate

    summary = BatchSummary()
    for record in records:
        summary.total += 1
        cid = f"dryrun-{summary.total}"
        monitor.start_record(cid, record.describe())
        _, findings = validate(record, writer.reg, writer.cfg)
        monitor.record_findings(cid, findings)
        if _errors(findings) and writer.cfg.strict:
            summary.failed += 1
            summary.failures[cid] = f"{len(_errors(findings))} validation error(s)"
        else:
            summary.written += 1

    summary.finding_counts = dict(monitor.finding_counts)
    print(summary.render(), file=sys.stderr)
    print("DRY RUN - nothing was written.", file=sys.stderr)
    return summary
