"""
Everything you can push back into the CRM: portfolio analytics, and market series.

    from portfolio_data import PortfolioData, Characteristics, Breakdown, upload_pf_data
    from portfolio_data import quarter_end_for_label

    summary = upload_pf_data(PortfolioData(
        subject_id=model.id,                       # straight from get_models()
        sleeve="equity",
        as_of=quarter_end_for_label("Q1 2026"),
        characteristics=Characteristics(price_to_book=2.87, profitability=0.31),
        breakdowns=[Breakdown("region", {"US": 0.62, "Developed ex-US": 0.28,
                                         "Emerging Markets": 0.10})],
        source="Morningstar Direct 2026-04-02",
    ))
    raise SystemExit(summary.exit_code)

Per-record failure isolation: one bad record is recorded in the summary and the rest of the
batch continues. `dry_run=True` runs the full validation matrix against live data and
writes nothing — do that first when wiring up a new export.

Benchmarks travel this same path with `subject_kind="benchmark"`. Every card on the
dashboard is captioned "vs <index>", so the index's numbers have to live in the same tables
and be queried the same way as the models they are compared against.
"""

import logging
from typing import Dict, Iterable, List, Optional, Sequence, Union

from .core.config import PortfolioConfig, resolve
from .core.models import Finding, MarketPoint, PortfolioData, UploadSummary, errors
from .db.connection import open_portfolio
from .db.reader import load_known_subjects
from .db.schema import bootstrap
from .db.verify import verify_payload
from .db.writer import prune_orphans as _prune_orphans
from .db.writer import write_market_points, write_payload
from .validation.rules import validate_market_point, validate_payload

__all__ = ["upload_pf_data", "upload_market_series", "prune_orphans"]

_log = logging.getLogger("portfolio_data")

PayloadInput = Union[PortfolioData, Dict, Iterable[Union[PortfolioData, Dict]]]


def _coerce(payload: PayloadInput) -> List[PortfolioData]:
    """Accept one record, a dict, or any iterable of either."""
    if isinstance(payload, (PortfolioData, dict)):
        payload = [payload]
    out: List[PortfolioData] = []
    for item in payload:
        out.append(item if isinstance(item, PortfolioData) else PortfolioData.from_dict(item))
    return out


def _reportable(findings: Sequence[Finding], cfg: PortfolioConfig) -> List[Finding]:
    return [f for f in findings if f.severity in cfg.report_on]


def upload_pf_data(
    payload: PayloadInput,
    *,
    strict: Optional[bool] = None,
    dry_run: bool = False,
    cfg: Optional[PortfolioConfig] = None,
) -> UploadSummary:
    """
    Write characteristics, breakdowns and performance for one or many subjects.

    Args:
        payload: A `PortfolioData`, a dict in its shape, or any iterable of either.
            Dicts are converted by `PortfolioData.from_dict`, which *rejects* unknown
            keys rather than dropping them — a misspelled metric is a loud failure, not
            a value that silently never gets stored.
        strict: ERROR findings abort the record before its transaction opens. Defaults to
            `cfg.strict` (True). Set False for a backfill where you accept messy data.
        dry_run: Validate everything against live data and write nothing.
        cfg: Reuse a resolved config across calls. None reads the environment.

    Returns:
        An `UploadSummary`: counts, findings, `render()` for a human, and an `exit_code`
        a scheduler can alert on. Records that fail are recorded, not raised — one bad
        row never aborts a batch.
    """
    resolved = resolve(cfg)
    is_strict = resolved.strict if strict is None else strict

    records = _coerce(payload)
    summary = UploadSummary(total=len(records), dry_run=dry_run)
    if not records:
        return summary

    conn = open_portfolio(resolved)
    try:
        # Idempotent, and a no-op once the tables exist. Runs even on a dry run so that
        # validating against a fresh database still resolves the benchmark registry.
        bootstrap(conn, resolved)
        model_ids, benchmarks = load_known_subjects(resolved)

        for record in records:
            label = record.describe()
            try:
                findings = validate_payload(record, resolved, model_ids, benchmarks)
                summary.record_findings(_reportable(findings, resolved))

                blocking = errors(findings)
                if blocking and is_strict:
                    summary.failed += 1
                    summary.failures[label] = "; ".join(str(f) for f in blocking)
                    continue
                if blocking:
                    _log.warning("Writing %s despite %d error finding(s) (strict=False).",
                                 label, len(blocking))

                if record.is_empty:
                    summary.skipped += 1
                    continue

                if dry_run:
                    summary.written += 1
                    summary.written_keys.append(label)
                    continue

                write_payload(conn, resolved, record)

                if resolved.verify_after_write:
                    problems = verify_payload(resolved, record)
                    if problems:
                        summary.record_findings(problems)
                        summary.failed += 1
                        summary.failures[label] = "; ".join(str(f) for f in problems)
                        continue

                summary.written += 1
                summary.written_keys.append(label)

            except Exception as exc:  # noqa: BLE001 — isolate the record, keep the batch
                summary.failed += 1
                summary.failures[label] = f"{type(exc).__name__}: {exc}"
                _log.exception("Upload failed for %s", label)
    finally:
        conn.close()

    return summary


def upload_market_series(
    points: Union[MarketPoint, Iterable[MarketPoint]],
    *,
    strict: Optional[bool] = None,
    dry_run: bool = False,
    cfg: Optional[PortfolioConfig] = None,
) -> UploadSummary:
    """
    Write market-level observations — Treasury par yields by tenor, credit spreads.

    Separate from `upload_pf_data` because these belong to the market, not to a portfolio:
    there is no subject, no sleeve, and — unlike model data — no requirement that `as_of`
    be a quarter end. A yield curve is naturally daily and the credit-spread card plots a
    history, so constraining these to quarter ends would throw away the series' shape.

    Valid points are written even when others in the batch fail, and re-uploading a point
    simply replaces its value.
    """
    resolved = resolve(cfg)
    is_strict = resolved.strict if strict is None else strict

    if isinstance(points, MarketPoint):
        points = [points]
    listed = list(points)

    summary = UploadSummary(total=len(listed), dry_run=dry_run)
    if not listed:
        return summary

    writable: List[MarketPoint] = []
    for point in listed:
        label = point.describe()
        findings = validate_market_point(point, resolved)
        summary.record_findings(_reportable(findings, resolved))

        blocking = errors(findings)
        if blocking and is_strict:
            summary.failed += 1
            summary.failures[label] = "; ".join(str(f) for f in blocking)
            continue
        writable.append(point)

    if not writable:
        return summary

    if dry_run:
        summary.written = len(writable)
        summary.written_keys = [p.describe() for p in writable]
        return summary

    conn = open_portfolio(resolved)
    try:
        bootstrap(conn, resolved)
        write_market_points(conn, resolved, writable)
        summary.written = len(writable)
        summary.written_keys = [p.describe() for p in writable]
    except Exception as exc:  # noqa: BLE001
        # One transaction covers the batch, so a failure here loses all of it.
        summary.failed += len(writable)
        summary.written = 0
        summary.failures["market series batch"] = f"{type(exc).__name__}: {exc}"
        _log.exception("Market series upload failed")
    finally:
        conn.close()

    return summary


def prune_orphans(
    *, dry_run: bool = True, cfg: Optional[PortfolioConfig] = None
) -> Dict[str, int]:
    """
    Report (and optionally delete) analytics whose model no longer exists.

    `subject_id` points at `client_models`, which lives in a different file, so SQLite
    cannot enforce a foreign key and a model deleted in the dashboard leaves its numbers
    behind. Left alone they inflate every rollup that counts rows.

    Defaults to a dry run — call with `dry_run=False` to actually delete. Benchmarks are
    never treated as orphans; they have no model row by design.

    Returns:
        `{table_name: row_count}` for the rows found, or removed.
    """
    resolved = resolve(cfg)
    model_ids, _ = load_known_subjects(resolved)

    conn = open_portfolio(resolved)
    try:
        bootstrap(conn, resolved)
        return _prune_orphans(conn, resolved, model_ids, dry_run=dry_run)
    finally:
        conn.close()
