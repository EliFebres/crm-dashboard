"""
The pre-write matrix. Every rule here exists because a specific value produces a specific
*silent* failure — the write succeeds, nothing errors, and the number on the dashboard is
wrong or the row is invisible.

That is the same standard crm_sync's validation holds itself to, and for the same reason:
nothing about a successful `INSERT` tells you the data is usable. A row whose `sleeve` is
`'Equity'` instead of `'equity'` is stored perfectly and matched by no query. A return of
`8.4` that meant 8.4% renders as 840% with no complaint from anything. A credit breakdown
summing to 0.97 draws a chart that quietly stops short of the edge.

In strict mode an ERROR aborts the record before a transaction opens, so a bad record costs
nothing. A WARN is written and reported — it flags the things that are usually a
column-mapping mistake in the export but are occasionally legitimate.

Pure functions over payloads: nothing here opens a file. The two things a rule needs from
the database — the set of live model ids and the benchmark registry — are snapshotted once
per upload by `db/reader.load_known_subjects` and passed in.
"""

import dataclasses
import math
from typing import Dict, List, Set

from ..core.config import PortfolioConfig
from ..core.models import Breakdown, Characteristics, Finding, MarketPoint, Performance, PortfolioData, Severity
from ..core.periods import is_quarter_end, parse_iso_date, quarter_label
from .vocabulary import (
    BREAKDOWN_DIMENSIONS,
    EQUITY_DIMENSIONS,
    EQUITY_SLEEVES,
    FIXED_INCOME_DIMENSIONS,
    MARKET_SERIES,
    SLEEVE_FIXED_INCOME,
    SLEEVE_TOTAL,
    SLEEVES,
    SUBJECT_BENCHMARK,
    SUBJECT_KINDS,
    SUBJECT_MODEL,
)

#: Sleeves whose contents are a single asset class, so a metric or dimension belonging to
#: the *other* one is worth flagging. `total` is excluded: both groups are legitimate there.
_SINGLE_CLASS_SLEEVES = EQUITY_SLEEVES + (SLEEVE_FIXED_INCOME,)

__all__ = ["validate_payload", "validate_market_point"]


# ---------------------------------------------------------------------------------
# Field groupings the rules key on.
# ---------------------------------------------------------------------------------

#: Characteristics that only describe an equity portfolio. On a `fixed_income` sleeve
#: these are almost always a mis-mapped column in the export.
_EQUITY_CHARACTERISTICS = (
    "wtd_avg_market_cap", "median_market_cap", "price_to_book", "price_to_earnings",
    "price_to_sales", "profitability", "dividend_yield", "return_on_equity",
    "underlying_companies",
)

#: Characteristics that only describe a bond portfolio. Same, the other way round.
_FIXED_INCOME_CHARACTERISTICS = (
    "effective_duration", "effective_maturity", "yield_to_maturity", "sec_yield",
    "avg_coupon", "avg_credit_quality",
)

#: Stored as decimal fractions, so an out-of-range magnitude means someone sent percent.
#: This is the single most likely upload bug and the only one that cannot be spotted by
#: eye afterwards — 840% and 8.4% both look like plausible database contents.
_FRACTION_FIELDS = frozenset({
    # Performance
    "return_qtd", "return_ytd", "return_1y", "return_3y", "return_5y", "return_10y",
    "return_since_inception", "alpha_3y", "max_drawdown", "std_dev_3y",
    "tracking_error_3y", "up_capture_3y", "down_capture_3y",
    # Characteristics
    "dividend_yield", "return_on_equity", "yield_to_maturity", "sec_yield",
    "avg_coupon", "expense_ratio", "turnover",
})

#: A negative value here is definitely wrong, not merely unusual. Kept deliberately short:
#: price-to-earnings goes negative for a loss-making book, effective duration goes negative
#: in a short-duration fund, and profitability goes negative for unprofitable companies —
#: none of those belong on this list.
_NON_NEGATIVE_FIELDS = frozenset({
    "wtd_avg_market_cap", "median_market_cap", "price_to_sales", "dividend_yield",
    "effective_maturity", "num_holdings", "underlying_companies", "expense_ratio",
    "turnover", "std_dev_3y", "tracking_error_3y",
})

#: Bounded to [0, 1] by definition.
_UNIT_INTERVAL_FIELDS = frozenset({"r_squared_3y"})


def _f(field: str, code: str, severity: Severity, message: str) -> Finding:
    return Finding(field, code, severity, message)


def _err(field: str, code: str, message: str) -> Finding:
    return _f(field, code, Severity.ERROR, message)


def _warn(field: str, code: str, message: str) -> Finding:
    return _f(field, code, Severity.WARN, message)


def _set_fields(payload) -> Dict[str, object]:
    """The fields of a Characteristics/Performance that were actually supplied."""
    if payload is None:
        return {}
    return {
        f.name: getattr(payload, f.name)
        for f in dataclasses.fields(payload)
        if getattr(payload, f.name) is not None
    }


# ---------------------------------------------------------------------------------
# The key: subject, sleeve, as_of
# ---------------------------------------------------------------------------------


def _validate_key(
    record: PortfolioData,
    cfg: PortfolioConfig,
    model_ids: Set[str],
    benchmarks: Dict[str, str],
) -> List[Finding]:
    findings: List[Finding] = []

    if record.subject_kind not in SUBJECT_KINDS:
        findings.append(_err(
            "subject_kind", "subject_kind_unknown",
            f"{record.subject_kind!r} is not a subject kind. Valid: {', '.join(SUBJECT_KINDS)}.",
        ))
    elif record.subject_kind == SUBJECT_MODEL:
        if not record.subject_id:
            findings.append(_err("subject_id", "subject_id_blank", "A model subject needs an id."))
        elif record.subject_id not in model_ids:
            # Nothing joins to this row, ever. It is not an error the database can catch:
            # client_models lives in a different file, so there is no foreign key to fail.
            findings.append(_err(
                "subject_id", "subject_not_a_model",
                f"No client_models row with id {record.subject_id!r}. The model may have been "
                f"deleted since you pulled it; re-run get_models(). Nothing joins to an "
                f"orphaned row, so it would be stored and never read.",
            ))
    elif record.subject_kind == SUBJECT_BENCHMARK:
        if record.subject_id not in benchmarks:
            findings.append(_err(
                "subject_id", "benchmark_not_registered",
                f"Benchmark {record.subject_id!r} is not in pf_benchmarks. Register it first — "
                f"known: {', '.join(sorted(benchmarks)) or '(none)'}.",
            ))
        elif (
            record.sleeve in _SINGLE_CLASS_SLEEVES
            and benchmarks[record.subject_id] not in (record.sleeve, SLEEVE_TOTAL)
        ):
            findings.append(_warn(
                "sleeve", "benchmark_sleeve_mismatch",
                f"{record.subject_id!r} is registered as a {benchmarks[record.subject_id]!r} "
                f"benchmark but is being uploaded against the {record.sleeve!r} sleeve.",
            ))

    if record.sleeve not in SLEEVES:
        findings.append(_err(
            "sleeve", "sleeve_unknown",
            f"{record.sleeve!r} is not a sleeve. Valid: {', '.join(SLEEVES)}. The dashboard "
            f"filters on these exact strings, so any other value is stored and never matched.",
        ))

    if parse_iso_date(record.as_of) is None:
        findings.append(_err(
            "as_of", "as_of_not_iso",
            f"{record.as_of!r} is not a YYYY-MM-DD date.",
        ))
    elif cfg.quarter_end_only and not is_quarter_end(record.as_of):
        findings.append(_err(
            "as_of", "as_of_not_quarter_end",
            f"{record.as_of} is not a quarter end. The period dropdown offers completed "
            f"quarters only, so this row could never be selected. Use "
            f"quarter_end_for_label('{quarter_label(record.as_of)}') to get the right date.",
        ))

    return findings


# ---------------------------------------------------------------------------------
# Metric values
# ---------------------------------------------------------------------------------


def _validate_numbers(field_values: Dict[str, object], cfg: PortfolioConfig, group: str) -> List[Finding]:
    findings: List[Finding] = []
    for name, value in field_values.items():
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        number = float(value)

        if math.isnan(number) or math.isinf(number):
            findings.append(_err(name, "value_not_finite", f"{group}.{name} is {value!r}."))
            continue

        if name in _NON_NEGATIVE_FIELDS and number < 0:
            findings.append(_err(
                name, "value_negative", f"{group}.{name} cannot be negative (got {number}).",
            ))

        if name in _UNIT_INTERVAL_FIELDS and not 0.0 <= number <= 1.0:
            findings.append(_err(
                name, "value_out_of_unit_interval",
                f"{group}.{name} must be between 0 and 1 (got {number}). R-squared of 87% "
                f"is 0.87, not 87.",
            ))

        if name in _FRACTION_FIELDS and abs(number) > cfg.max_plausible_return:
            findings.append(_err(
                name, "value_looks_like_percent",
                f"{group}.{name} is {number}, which reads as {number * 100:g}%. These are "
                f"stored as decimal fractions — 8.4% is 0.084, not 8.4. Raise "
                f"max_plausible_return if the value is genuinely this large.",
            ))
    return findings


def _validate_sleeve_fit(record: PortfolioData) -> List[Finding]:
    """
    Warn when equity metrics land on a bond sleeve, or vice versa.

    A warning, not an error: both groups are legitimate on `total`, and an analytics engine
    occasionally emits a defensible cross-metric. But a duration on an equity-only sleeve
    is nearly always a column shifted by one in the export, and that is invisible once
    stored.
    """
    if record.sleeve not in _SINGLE_CLASS_SLEEVES:
        return []

    is_equity = record.sleeve in EQUITY_SLEEVES
    supplied = set(_set_fields(record.characteristics))
    wrong_group = _FIXED_INCOME_CHARACTERISTICS if is_equity else _EQUITY_CHARACTERISTICS
    misfits = sorted(supplied.intersection(wrong_group))
    if not misfits:
        return []

    other = "fixed-income" if is_equity else "equity"
    return [_warn(
        "characteristics", "metric_sleeve_mismatch",
        f"{other.capitalize()} metric(s) on the {record.sleeve!r} sleeve: "
        f"{', '.join(misfits)}. Usually a mis-mapped column in the export.",
    )]


# ---------------------------------------------------------------------------------
# Breakdowns
# ---------------------------------------------------------------------------------


def _validate_breakdowns(record: PortfolioData, cfg: PortfolioConfig) -> List[Finding]:
    findings: List[Finding] = []
    seen: Set[str] = set()

    for breakdown in record.breakdowns:
        if not isinstance(breakdown, Breakdown):
            findings.append(_err("breakdowns", "breakdown_wrong_type",
                                 f"Expected a Breakdown, got {type(breakdown).__name__}."))
            continue

        dimension = breakdown.dimension
        field = f"breakdowns.{dimension}"

        if dimension in seen:
            # Both would be written to the same key and the second would win silently.
            findings.append(_err(field, "breakdown_duplicated",
                                 f"Dimension {dimension!r} appears twice in one payload."))
            continue
        seen.add(dimension)

        buckets = BREAKDOWN_DIMENSIONS.get(dimension)
        if buckets is None:
            findings.append(_err(
                field, "dimension_unknown",
                f"{dimension!r} is not a breakdown dimension. Valid: "
                f"{', '.join(sorted(BREAKDOWN_DIMENSIONS))}. Add it to "
                f"validation/vocabulary.py if the dashboard has grown a card for it.",
            ))
            continue

        if not breakdown.weights:
            findings.append(_warn(field, "breakdown_empty",
                                  f"{dimension!r} carries no weights; nothing will be written."))
            continue

        unknown = sorted(set(breakdown.weights) - set(buckets))
        if unknown:
            findings.append(_err(
                field, "bucket_unknown",
                f"{dimension!r} has bucket(s) {', '.join(repr(u) for u in unknown)} outside "
                f"its vocabulary ({', '.join(buckets)}). An unrecognized bucket renders as a "
                f"slice with no legend entry.",
            ))

        bad_values = {k: v for k, v in breakdown.weights.items()
                      if not isinstance(v, (int, float)) or isinstance(v, bool)
                      or math.isnan(float(v)) or math.isinf(float(v)) or float(v) < 0}
        if bad_values:
            findings.append(_err(
                field, "bucket_weight_invalid",
                f"{dimension!r} has non-finite or negative weight(s): "
                f"{', '.join(f'{k}={v!r}' for k, v in sorted(bad_values.items()))}.",
            ))
            continue

        total = breakdown.total_weight
        if abs(total - 1.0) > cfg.weight_tolerance:
            findings.append(_err(
                field, "breakdown_does_not_sum",
                f"{dimension!r} weights sum to {total:.4f}, not 1.0 (tolerance "
                f"{cfg.weight_tolerance}). A chart drawn from this quietly does not reach "
                f"100%. Weights are fractions of the sleeve, so they must total 1.",
            ))

        if record.sleeve in _SINGLE_CLASS_SLEEVES:
            is_equity = record.sleeve in EQUITY_SLEEVES
            wrong = FIXED_INCOME_DIMENSIONS if is_equity else EQUITY_DIMENSIONS
            if dimension in wrong:
                findings.append(_warn(
                    field, "dimension_sleeve_mismatch",
                    f"{dimension!r} describes a "
                    f"{'fixed-income' if is_equity else 'equity'} portfolio "
                    f"but is on the {record.sleeve!r} sleeve.",
                ))

    return findings


# ---------------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------------


def validate_payload(
    record: PortfolioData,
    cfg: PortfolioConfig,
    model_ids: Set[str],
    benchmarks: Dict[str, str],
) -> List[Finding]:
    """
    Run the full matrix over one upload record. An empty list means it is good to write.

    Ordered so the cheapest, most fundamental checks come first: there is no point
    complaining about a price-to-book when the sleeve name is misspelled and the row would
    be invisible regardless.
    """
    findings = _validate_key(record, cfg, model_ids, benchmarks)

    findings.extend(_validate_numbers(_set_fields(record.characteristics), cfg, "characteristics"))
    findings.extend(_validate_numbers(_set_fields(record.performance), cfg, "performance"))
    findings.extend(_validate_sleeve_fit(record))
    findings.extend(_validate_breakdowns(record, cfg))

    if record.performance is not None:
        benchmark_id = record.performance.benchmark_id
        if benchmark_id and benchmark_id not in benchmarks:
            findings.append(_warn(
                "performance.benchmark_id", "benchmark_id_unregistered",
                f"Relative statistics reference benchmark {benchmark_id!r}, which is not in "
                f"pf_benchmarks. The numbers are stored, but nothing can resolve what they "
                f"were measured against.",
            ))

    if record.is_empty:
        findings.append(_warn(
            "payload", "payload_empty",
            "No characteristics, performance or breakdowns — this record would write nothing "
            "and still report success.",
        ))

    return findings


def validate_market_point(point: MarketPoint, cfg: PortfolioConfig) -> List[Finding]:
    """
    Run the matrix over one market observation.

    Note what is *not* checked: `as_of` is not required to be a quarter end. The yield
    curve is naturally daily and the credit-spread card plots a history, so constraining
    these to quarter ends would throw away the shape of the series.
    """
    findings: List[Finding] = []

    spec = MARKET_SERIES.get(point.series)
    if spec is None:
        findings.append(_err(
            "series", "series_unknown",
            f"{point.series!r} is not a known market series. Valid: "
            f"{', '.join(sorted(MARKET_SERIES))}. Add it to validation/vocabulary.py first.",
        ))
    else:
        tenors = spec["tenors"]
        if point.tenor not in tenors:
            shown = ", ".join(repr(t) for t in tenors)
            findings.append(_err(
                "tenor", "tenor_unknown",
                f"{point.tenor!r} is not a tenor of {point.series!r}. Valid: {shown}. "
                f"(A series with no term structure uses '' — never None, which SQLite would "
                f"accept into the primary key and then allow duplicates of.)",
            ))

    if parse_iso_date(point.as_of) is None:
        findings.append(_err("as_of", "as_of_not_iso", f"{point.as_of!r} is not a YYYY-MM-DD date."))

    if not isinstance(point.value, (int, float)) or isinstance(point.value, bool):
        findings.append(_err("value", "value_not_numeric", f"value is {point.value!r}."))
    else:
        number = float(point.value)
        if math.isnan(number) or math.isinf(number):
            findings.append(_err("value", "value_not_finite", f"value is {point.value!r}."))
        elif spec is not None:
            low, high = spec["plausible"]
            if not low <= number <= high:
                unit = spec["unit"]
                hint = (
                    " Yields are decimal fractions — 4.25% is 0.0425, not 4.25."
                    if unit == "decimal_fraction" else
                    " Spreads are basis points — 1.20% is 120, not 1.2."
                )
                findings.append(_err(
                    "value", "value_implausible",
                    f"{number:g} is outside the plausible range for {point.series!r} "
                    f"({low:g} to {high:g}, {unit}).{hint}",
                ))

    return findings
