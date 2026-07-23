"""
Data shapes exchanged across the portfolio_data boundary.

Two directions, two families:

**Out** (`get_models`) — `LoggedModel`, each carrying three `Sleeve`s. This is what you
hand to an analytics engine.

**In** (`upload_pf_data`) — `PortfolioData`, bundling `Characteristics`, `Performance` and
`Breakdown`s for one (subject, sleeve, as_of). This is what you get back from it.

Every field on `Characteristics` and `Performance` is Optional and defaults to None,
meaning *not measured*. None is written as SQL NULL and, on a re-upload, leaves whatever
was already stored alone (see the COALESCE in db/writer.py) — so performance can land in a
separate pass from characteristics without either wiping the other. That is the whole
reason these are Optional rather than required-with-a-sentinel.

The field names here ARE the column names: db/schema.py derives the CREATE TABLE and the
upsert column lists from these dataclasses by reflection. Rename a field and the column
renames with it; there is no second list to keep in step.

This module imports nothing from the rest of the package, so `exceptions.py` can import it
without a cycle.
"""

import dataclasses
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple, get_args, get_type_hints

from crm_sync.core.models import (
    EXIT_OK,
    EXIT_PARTIAL_FAILURE,
    EXIT_STARTUP_FAILURE,
    EXIT_TOTAL_FAILURE,
    Finding,
    Severity,
    errors,
)

__all__ = [
    "Finding",
    "Severity",
    "errors",
    "EXIT_OK",
    "EXIT_PARTIAL_FAILURE",
    "EXIT_STARTUP_FAILURE",
    "EXIT_TOTAL_FAILURE",
    "Holding",
    "Sleeve",
    "LoggedModel",
    "Characteristics",
    "Performance",
    "Breakdown",
    "PortfolioData",
    "MarketPoint",
    "UploadSummary",
    "payload_columns",
]


# =================================================================================
# Out: what get_models() returns
# =================================================================================


@dataclass(frozen=True)
class Holding:
    """One position. `weight` is relative to the sleeve it sits in, not to the portfolio."""

    identifier: str          # ticker / ISIN / CUSIP, uppercased during normalization
    constituent_type: str    # Portfolio | Morningstar-Fund | Security | Index
    asset_class: str
    weight: float


@dataclass(frozen=True)
class Sleeve:
    """
    A slice of a model, renormalized to stand on its own.

    `holdings` always sums to 1.0 (or is empty). `weight_of_total` is what fraction of the
    original portfolio this slice represented — the number you lose by rescaling, and the
    one you need to weight a sleeve-level statistic back up to portfolio level.
    """

    name: str
    holdings: Tuple[Holding, ...] = ()
    weight_of_total: float = 0.0

    def __bool__(self) -> bool:
        """Falsy when empty, so `if model.equity:` reads the way you'd expect."""
        return bool(self.holdings)

    def __len__(self) -> int:
        return len(self.holdings)

    @property
    def identifiers(self) -> List[str]:
        """Just the tickers — the usual thing to hand a security-master lookup."""
        return [h.identifier for h in self.holdings]


@dataclass(frozen=True)
class LoggedModel:
    """
    One logged client model, split into the three portfolios an analytics run needs.

    `id` is `client_models.id` — the value to pass back as `PortfolioData.subject_id`.
    The `client_dept` / `logged_team` / `logged_office` fields come from the interaction
    that logged the model and are what the dashboard filters on; they are carried here so
    a caller can segment a pull without a second query.
    """

    id: str
    crn: str
    client_name: str
    model_name: str
    is_main: bool
    aum: Optional[int]
    client_dept: Optional[str]
    logged_team: Optional[str]
    logged_office: Optional[str]
    logged_at: Optional[str]
    source_engagement_id: Optional[int]
    total: Sleeve
    equity: Sleeve
    fixed_income: Sleeve

    def sleeve(self, name: str) -> Sleeve:
        """Look a sleeve up by its name ('total' | 'equity' | 'fixed_income')."""
        try:
            return {"total": self.total, "equity": self.equity, "fixed_income": self.fixed_income}[name]
        except KeyError:
            raise ValueError(f"Unknown sleeve {name!r}") from None

    def describe(self) -> str:
        """Short human label for logs and alerts."""
        return f"{self.client_name} / {self.model_name} ({self.id[:8]})"


# =================================================================================
# In: what upload_pf_data() accepts
# =================================================================================


@dataclass
class Characteristics:
    """
    Portfolio characteristics for one (subject, sleeve, as_of).

    Split into an equity group and a fixed-income group because that is how the dashboard
    cards consume them, and because a duration on an equity sleeve (or a price-to-book on
    a bond sleeve) is a mapping mistake worth warning about. Both groups are legitimate on
    the `total` sleeve.

    Ratios are ratios, not percentages: `dividend_yield=0.021` means 2.1%. A value of 2.1
    would be read as 210% by everything downstream, so validation rejects it.
    """

    # --- equity: Style XY, Profitability XY, Metrics vs Index ---
    wtd_avg_market_cap: Optional[float] = None    # dollars
    median_market_cap: Optional[float] = None     # dollars
    price_to_book: Optional[float] = None
    price_to_earnings: Optional[float] = None
    price_to_sales: Optional[float] = None
    #: Gross profits / total assets. A bare ratio, not a percentage and not a fraction of
    #: anything — it runs roughly 0.00 to 5.00, with most clients between 0.20 and 0.60.
    #: Deliberately absent from the percent-vs-fraction magnitude check for that reason:
    #: a profitability of 2.4 is a real reading, not a misplaced decimal point.
    profitability: Optional[float] = None
    dividend_yield: Optional[float] = None        # decimal fraction
    return_on_equity: Optional[float] = None      # decimal fraction
    underlying_companies: Optional[int] = None    # look-through issuer count

    # --- fixed income: FI Metrics ---
    effective_duration: Optional[float] = None    # years
    effective_maturity: Optional[float] = None    # years
    yield_to_maturity: Optional[float] = None     # decimal fraction
    sec_yield: Optional[float] = None             # decimal fraction
    avg_coupon: Optional[float] = None            # decimal fraction
    avg_credit_quality: Optional[str] = None      # e.g. 'AA-'; free text, not a bucket

    # --- either sleeve ---
    num_holdings: Optional[int] = None
    expense_ratio: Optional[float] = None         # decimal fraction
    turnover: Optional[float] = None              # decimal fraction


@dataclass
class Performance:
    """
    Returns and risk statistics for one (subject, sleeve, as_of).

    Everything that is conceptually a percentage is stored as a decimal fraction —
    returns, alpha, drawdown, standard deviation, tracking error, and the capture ratios
    (`up_capture_3y=0.95`, not 95). Only the genuinely unitless statistics — beta, Sharpe,
    R-squared, information ratio — are stored as-is.

    `benchmark_id` records which benchmark the relative statistics (alpha, beta, capture,
    tracking error) were measured against, so a number computed against the wrong index is
    identifiable rather than merely wrong.
    """

    return_qtd: Optional[float] = None
    return_ytd: Optional[float] = None
    return_1y: Optional[float] = None
    return_3y: Optional[float] = None
    return_5y: Optional[float] = None
    return_10y: Optional[float] = None
    return_since_inception: Optional[float] = None

    std_dev_3y: Optional[float] = None
    sharpe_3y: Optional[float] = None
    beta_3y: Optional[float] = None
    alpha_3y: Optional[float] = None
    r_squared_3y: Optional[float] = None
    tracking_error_3y: Optional[float] = None
    information_ratio_3y: Optional[float] = None
    up_capture_3y: Optional[float] = None
    down_capture_3y: Optional[float] = None
    max_drawdown: Optional[float] = None

    benchmark_id: Optional[str] = None


@dataclass
class Breakdown:
    """
    One weight distribution — e.g. `Breakdown('region', {'US': 0.62, ...})`.

    `weights` must sum to 1.0 within tolerance and every key must be a bucket the
    dimension declares in validation/vocabulary.py. Both rules exist because the failure
    is silent otherwise: a distribution summing to 0.97 draws a chart that quietly does
    not reach 100%, and an unknown bucket becomes a slice with no legend entry.

    A bucket with zero weight may be omitted; it does not need an explicit 0.0.

    `names` is the optional holding count per bucket — how many distinct securities make
    up that weight. It is a genuinely separate fact, not something derivable from the
    weights: 40% of a portfolio can sit in four names or four hundred, and which one it is
    is the difference between a concentrated bet and an index-like sleeve. Supply it where
    the analytics engine knows it; omit it and the column simply reads as unknown.
    """

    dimension: str
    weights: Dict[str, float] = field(default_factory=dict)
    names: Dict[str, int] = field(default_factory=dict)

    @property
    def total_weight(self) -> float:
        return sum(self.weights.values())


@dataclass
class PortfolioData:
    """
    Everything known about one (subject, sleeve, as_of), in one upload record.

    `subject_id` is a `client_models.id` when `subject_kind='model'` (pass
    `LoggedModel.id` straight through), or a registered benchmark id such as
    'MSCI-ACWI-IMI' when `subject_kind='benchmark'`. Benchmarks deliberately travel the
    same path as models: every card on the page is captioned "vs <index>", so the index's
    numbers have to live in the same tables and be queried the same way.

    `as_of` must be a quarter end — see core/periods.py for why, and for
    `quarter_end_for_label('Q1 2026')` to produce one.

    Any of the three payloads may be omitted; a record carrying none of them is a no-op
    and warns.
    """

    subject_id: str
    sleeve: str
    as_of: str
    subject_kind: str = "model"
    characteristics: Optional[Characteristics] = None
    performance: Optional[Performance] = None
    breakdowns: List[Breakdown] = field(default_factory=list)
    #: Free text naming where the numbers came from ("Morningstar Direct 2026-04-02").
    #: Stored alongside the row, so a bad batch can be found and re-pulled later.
    source: Optional[str] = None

    def describe(self) -> str:
        return f"{self.subject_kind}:{self.subject_id} / {self.sleeve} @ {self.as_of}"

    @property
    def is_empty(self) -> bool:
        return self.characteristics is None and self.performance is None and not self.breakdowns

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "PortfolioData":
        """
        Build from a plain dict, rejecting unknown keys.

        Rejection is the point. Silently dropping a misspelled `price_to_books` would
        produce an upload that reports success and stores nothing for that metric, which
        is the exact failure mode this package exists to prevent.
        """
        if not isinstance(raw, dict):
            raise TypeError(f"Expected a dict or PortfolioData, got {type(raw).__name__}")

        data = dict(raw)
        nested = {
            "characteristics": Characteristics,
            "performance": Performance,
        }
        for key, klass in nested.items():
            value = data.get(key)
            if isinstance(value, dict):
                _reject_unknown(klass, value, key)
                data[key] = klass(**value)

        raw_breakdowns = data.get("breakdowns")
        if isinstance(raw_breakdowns, dict):
            # {'region': {...}, 'style': {...}} is the shape people reach for first.
            data["breakdowns"] = [Breakdown(dim, w) for dim, w in raw_breakdowns.items()]
        elif isinstance(raw_breakdowns, list):
            data["breakdowns"] = [
                Breakdown(**b) if isinstance(b, dict) else b for b in raw_breakdowns
            ]

        _reject_unknown(cls, data, "payload")
        return cls(**data)


def _reject_unknown(klass: type, values: Dict[str, Any], where: str) -> None:
    known = {f.name for f in dataclasses.fields(klass)}
    unknown = sorted(set(values) - known)
    if unknown:
        raise ValueError(
            f"Unknown {where} field(s): {', '.join(unknown)}. "
            f"Valid fields: {', '.join(sorted(known))}"
        )


@dataclass
class MarketPoint:
    """
    One market-level observation — a point on the Treasury curve, or a credit spread.

    Not tied to a model or a sleeve, which is why these travel through
    `get_market_series` / `upload_market_series` instead of a `PortfolioData`.

    `tenor` is '' for a series with no term structure. Empty string rather than None
    because it is part of the primary key, and SQLite permits NULLs in primary keys —
    a NULL tenor would silently allow duplicate points for the same day.
    """

    series: str
    as_of: str
    value: float
    tenor: str = ""
    source: Optional[str] = None

    def describe(self) -> str:
        return f"{self.series}{f'[{self.tenor}]' if self.tenor else ''} @ {self.as_of}"


# =================================================================================
# Reflection: the dataclasses above ARE the schema
# =================================================================================

_SQL_TYPES = {float: "REAL", int: "INTEGER", str: "TEXT"}


def payload_columns(klass: type) -> List[Tuple[str, str]]:
    """
    Reflect a payload dataclass into `(column_name, sql_type)` pairs.

    db/schema.py builds CREATE TABLE from this and db/writer.py builds its upsert column
    list from it, so a field added to `Characteristics` becomes a column with no second
    edit anywhere. The alternative — a hand-maintained column tuple beside the dataclass —
    drifts, and the symptom is an upload that accepts a value and never stores it.
    """
    hints = get_type_hints(klass)
    columns: List[Tuple[str, str]] = []
    for f in dataclasses.fields(klass):
        # Every payload field is Optional[X]; unwrap to X to pick the SQL type.
        args = [a for a in get_args(hints[f.name]) if a is not type(None)]
        python_type = args[0] if args else hints[f.name]
        columns.append((f.name, _SQL_TYPES.get(python_type, "TEXT")))
    return columns


# =================================================================================
# Result reporting
# =================================================================================


@dataclass
class UploadSummary:
    """
    Aggregate outcome of one `upload_pf_data` / `upload_market_series` call.

    Mirrors crm_sync's BatchSummary, including its exit codes, so a scheduler can treat a
    portfolio upload and a CRM sync identically: alert on non-zero, and distinguish
    "couldn't start" from "ran but some records failed".
    """

    total: int = 0
    written: int = 0
    skipped: int = 0
    failed: int = 0
    dry_run: bool = False
    #: what was written, as (subject_kind, subject_id, sleeve, as_of) or a series key
    written_keys: List[str] = field(default_factory=list)
    #: record label -> the exception string that killed it
    failures: Dict[str, str] = field(default_factory=dict)
    finding_counts: Dict[str, int] = field(default_factory=dict)
    findings: List[Finding] = field(default_factory=list)

    @property
    def exit_code(self) -> int:
        if self.total == 0 or self.failed == 0:
            return EXIT_OK
        if self.failed == self.total:
            return EXIT_TOTAL_FAILURE
        return EXIT_PARTIAL_FAILURE

    def record_findings(self, findings: List[Finding]) -> None:
        self.findings.extend(findings)
        for f in findings:
            self.finding_counts[f.severity.value] = self.finding_counts.get(f.severity.value, 0) + 1

    def to_dict(self) -> Dict[str, Any]:
        return {
            "total": self.total,
            "written": self.written,
            "skipped": self.skipped,
            "failed": self.failed,
            "dry_run": self.dry_run,
            "failures": self.failures,
            "finding_counts": self.finding_counts,
            "findings": [f.to_dict() for f in self.findings],
            "exit_code": self.exit_code,
        }

    def render(self) -> str:
        """Multi-line human summary, printed at the end of an upload."""
        # Plain ASCII: this goes to a console, and cmd.exe's default code page turns an
        # em dash into a replacement character.
        verb = "validated" if self.dry_run else "written"
        lines = [
            "=" * 66,
            f"portfolio_data upload summary{'  [DRY RUN - nothing written]' if self.dry_run else ''}",
            "=" * 66,
            f"  records seen : {self.total}",
            f"  {verb:<13}: {self.written}",
            f"  skipped      : {self.skipped}  (nothing to write)",
            f"  failed       : {self.failed}",
        ]
        if self.finding_counts:
            counts = ", ".join(f"{k}={v}" for k, v in sorted(self.finding_counts.items()))
            lines.append(f"  findings     : {counts}")
        if self.failures:
            lines.append("  failures:")
            for label, msg in self.failures.items():
                lines.append(f"    - {label}: {msg}")
        lines.append(f"  exit code    : {self.exit_code}")
        lines.append("=" * 66)
        return "\n".join(lines)
