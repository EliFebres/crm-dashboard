"""
Post-write verification: prove the numbers will actually be readable.

A successful `INSERT` means almost nothing here. SQLite will happily store a row whose
sleeve matches no filter, whose `as_of` no period selector offers, and whose breakdown
weights no longer sum to 1 after a round trip through binary floating point. Every one of
those produces a row that *exists*, reports no error, and is wrong or invisible on the
surface someone reads.

So after the transaction commits we go back and re-read it — through a **fresh, read-only
connection**, not the writer's. That is the whole point, and it is the same reasoning
crm_sync/db/verify.py sets out: a separate connection proves the row is durable and visible
to *other processes*, which is exactly what the Next.js server is. Verifying through the
connection that wrote the row would prove nothing except that the writer remembers writing.

Every finding here is an ERROR. The write already committed, so there is nothing left to
prevent — only something to shout about.
"""

from typing import Dict, List

from ..core.config import PortfolioConfig
from ..core.models import Finding, PortfolioData, Severity
from ..core.periods import is_quarter_end
from .reader import read_breakdowns, read_characteristics, read_performance

__all__ = ["verify_payload"]


def _err(field: str, code: str, message: str) -> Finding:
    return Finding(field, code, Severity.ERROR, message)


def verify_payload(cfg: PortfolioConfig, record: PortfolioData) -> List[Finding]:
    """
    Re-read what `record` should have written and return the findings that would keep it
    off the dashboard. An empty list means the data is good.

    Only the payloads the record actually carried are checked — a record that supplied no
    performance is not expected to have produced a performance row.
    """
    findings: List[Finding] = []
    key = (record.subject_id, record.sleeve, record.as_of)
    kwargs = {"subject_kind": record.subject_kind}

    if record.characteristics is not None:
        stored = read_characteristics(cfg, *key, **kwargs)
        if stored is None:
            findings.append(_err(
                "characteristics", "row_not_readable",
                f"No pf_characteristics row for {record.describe()} on a fresh connection. "
                f"The write reported success but another process cannot see it.",
            ))
        else:
            findings.extend(_check_row_key(stored, record, "characteristics"))

    if record.performance is not None:
        stored = read_performance(cfg, *key, **kwargs)
        if stored is None:
            findings.append(_err(
                "performance", "row_not_readable",
                f"No pf_performance row for {record.describe()} on a fresh connection.",
            ))
        else:
            findings.extend(_check_row_key(stored, record, "performance"))

    expected = {b.dimension: b for b in record.breakdowns if b.weights}
    if expected:
        stored_breakdowns = {b.dimension: b for b in read_breakdowns(cfg, *key, **kwargs)}
        for dimension, breakdown in expected.items():
            found = stored_breakdowns.get(dimension)
            if found is None:
                findings.append(_err(
                    f"breakdowns.{dimension}", "breakdown_not_readable",
                    f"No {dimension!r} rows for {record.describe()} on a fresh connection.",
                ))
                continue

            missing = sorted(set(breakdown.weights) - set(found.weights))
            if missing:
                findings.append(_err(
                    f"breakdowns.{dimension}", "bucket_missing",
                    f"{dimension!r} is missing bucket(s) after the write: {', '.join(missing)}.",
                ))

            # Re-check the sum as *persisted*. Validation checked the payload; this checks
            # what came back out, which is what any chart will actually draw. REAL storage
            # is IEEE 754, so a distribution that summed to exactly 1.0 in Python can come
            # back a few ulps off — the tolerance absorbs that and nothing larger.
            total = found.total_weight
            if abs(total - 1.0) > cfg.weight_tolerance:
                findings.append(_err(
                    f"breakdowns.{dimension}", "breakdown_does_not_sum_persisted",
                    f"{dimension!r} sums to {total:.6f} as stored, not 1.0.",
                ))

    if cfg.quarter_end_only and not is_quarter_end(record.as_of):
        findings.append(_err(
            "as_of", "as_of_not_selectable",
            f"{record.as_of} is not a quarter end, so no period the dropdown offers will "
            f"ever select this row.",
        ))

    return findings


def _check_row_key(stored: Dict[str, object], record: PortfolioData, group: str) -> List[Finding]:
    """
    Assert the row came back under the key we asked for.

    Cheap, and it catches the one class of bug a value comparison would not: a key column
    silently coerced or mismatched, which would leave the data attached to a subject or
    sleeve nobody queries for.
    """
    findings: List[Finding] = []
    for column, expected in (
        ("subject_kind", record.subject_kind),
        ("subject_id", record.subject_id),
        ("sleeve", record.sleeve),
        ("as_of", record.as_of),
    ):
        actual = stored.get(column)
        if actual != expected:
            findings.append(_err(
                f"{group}.{column}", "key_mismatch",
                f"Stored {column} is {actual!r}, expected {expected!r}.",
            ))
    return findings
