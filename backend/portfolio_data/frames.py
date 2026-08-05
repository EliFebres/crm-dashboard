"""
The DataFrame front door: pull a table, fill in the blanks, hand it back.

    from portfolio_data import models_frame, blank_frame, upload_frame

    models = models_frame(min_aum=1_000_000_000)      # who is there
    df = blank_frame(models, sleeves=["equity"])      # one row per (model, sleeve, quarter)
    df.loc[df.sleeve == "equity", "price_to_book"] = 2.87
    print(upload_frame(df, source="Morningstar Direct", dry_run=True).render())

One row per (subject, sleeve, as_of); one column per thing you could measure. Every metric
column starts blank, and **blank means "not measured", which means "leave whatever is
already stored alone"** — the writer's COALESCE, surfaced as an empty cell. So a frame
carrying only returns does not erase the characteristics an earlier pass wrote, and there
is nothing to remember about partial uploads: fill what you have, leave the rest.

The one exception is a breakdown. Buckets are replaced wholesale per dimension, so a
dimension with *no* buckets filled is omitted from the upload entirely and is left
untouched, while a dimension with *some* filled is sent as-is and fails
`breakdown_does_not_sum` — correctly, because a distribution summing to 0.6 would draw a
chart that quietly stops short of the edge. Leave a whole dimension blank to leave it
alone; half-filling one is an error.

## The column families

    subject_kind, subject_id, sleeve, as_of     the key — every row needs all four
    crn, client_name, model_name, aum, ...      context, carried for reading; ignored on upload
    price_to_book, return_1y, ...               the 36 metrics, blank until you fill them
    region.US, credit_rating.AAA, ...           breakdown buckets, one column per bucket
    names.region.US, ...                        holding count behind that bucket (opt-in)
    source                                      where the numbers came from
    _anything                                   yours; ignored on upload

An unrecognized column is rejected rather than dropped. Dropping it is the failure this
package exists to prevent: a misspelled `price_to_books` produces an upload that reports
success and stores nothing, and nothing downstream ever says so.

None of this replaces the dataclass API — `upload_frame` builds `PortfolioData` objects and
calls `upload_pf_data`, so validation, verify-after-write and per-record failure isolation
are the same code they always were. See docs/README.md for the dataclass form, which is
what you want inside a scheduled job where a frame buys you nothing.
"""

import dataclasses
import difflib
import logging
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple, Union

import pandas as pd

from .core.config import PortfolioConfig, resolve
from .core.models import (
    Breakdown,
    Characteristics,
    LoggedModel,
    MarketPoint,
    Performance,
    PortfolioData,
    UploadSummary,
    payload_columns,
)
from .core.periods import quarter_end_for_label, quarter_label, recent_quarter_ends
from .db.reader import read_stored
from .pull import PULLABLE_SLEEVES, get_market_series, get_models
from .push import upload_market_series, upload_pf_data
from .validation.vocabulary import (
    BENCHMARK_NAMES,
    BREAKDOWN_DIMENSIONS,
    MARKET_SERIES,
    SLEEVE_BENCHMARK,
    SLEEVES,
    SUBJECT_BENCHMARK,
    SUBJECT_MODEL,
)

__all__ = [
    "models_frame",
    "holdings_frame",
    "blank_frame",
    "fill",
    "upload_frame",
    "stored_frame",
    "market_frame",
    "market_template",
    "upload_market_frame",
    "findings_frame",
    "template_columns",
    "KEY_COLUMNS",
    "CONTEXT_COLUMNS",
    "CHARACTERISTIC_COLUMNS",
    "PERFORMANCE_COLUMNS",
    "BREAKDOWN_COLUMNS",
    "NAMES_COLUMNS",
]

_log = logging.getLogger("portfolio_data")


# =================================================================================
# The column vocabulary — reflected from the dataclasses, never hand-listed
# =================================================================================

#: What identifies a row. All four are needed to write one; `subject_kind` defaults to
#: 'model' when the column is absent, because that is what a template built from models has.
KEY_COLUMNS: Tuple[str, ...] = ("subject_kind", "subject_id", "sleeve", "as_of")

#: Carried so a human can read the frame — which client, which model, how big. Ignored on
#: upload rather than rejected: they come off the template you were handed, and making you
#: drop them before uploading would be a chore with exactly one correct answer.
CONTEXT_COLUMNS: Tuple[str, ...] = (
    "crn", "client_name", "model_name", "is_main", "aum", "client_dept",
    "logged_team", "logged_office", "quarter", "sleeve_weight_of_total", "sleeve_positions",
)

CHARACTERISTIC_COLUMNS: Tuple[str, ...] = tuple(f.name for f in dataclasses.fields(Characteristics))
PERFORMANCE_COLUMNS: Tuple[str, ...] = tuple(f.name for f in dataclasses.fields(Performance))

#: Separator between a dimension and its bucket. A dot, because no dataclass field name
#: contains one — which is what makes column classification a lookup rather than a guess.
SEP = "."
NAMES_PREFIX = "names" + SEP

# A dimension literally called 'names' would be indistinguishable from the count namespace.
# Fail at import rather than at upload time if anyone ever adds one.
assert "names" not in BREAKDOWN_DIMENSIONS, "a breakdown dimension may not be named 'names'"

#: One column per (dimension, bucket). Bucket text is verbatim — spaces, hyphens and '&'
#: included — because validation matches those exact strings. It costs
#: `df["region.Developed ex-US"]` instead of attribute access, and buys one spelling.
BREAKDOWN_COLUMNS: Tuple[str, ...] = tuple(
    f"{dimension}{SEP}{bucket}"
    for dimension, buckets in BREAKDOWN_DIMENSIONS.items()
    for bucket in buckets
)

#: The optional holding count behind each bucket weight.
NAMES_COLUMNS: Tuple[str, ...] = tuple(NAMES_PREFIX + c for c in BREAKDOWN_COLUMNS)

#: {column: dimension} and {column: bucket}, for classification without re-splitting.
_BUCKET_OF: Dict[str, Tuple[str, str]] = {
    f"{dimension}{SEP}{bucket}": (dimension, bucket)
    for dimension, buckets in BREAKDOWN_DIMENSIONS.items()
    for bucket in buckets
}

#: Metric fields SQLite stores as INTEGER, reflected the same way the DDL is. A float in
#: one of these is coerced (with an integrality check) rather than passed through: the
#: column would otherwise hold 3184.0 where every reader expects 3184.
_INT_FIELDS = frozenset(
    name
    for name, sql_type in payload_columns(Characteristics) + payload_columns(Performance)
    if sql_type == "INTEGER"
)
_TEXT_FIELDS = frozenset(
    name
    for name, sql_type in payload_columns(Characteristics) + payload_columns(Performance)
    if sql_type == "TEXT"
)

#: Column -> dtype. Nullable Int64 for the counts so a blank shows as <NA> rather than
#: forcing the column to float64 and rendering 3184.0; explicit object for text because it
#: behaves the same under pandas 2.x and 3.x, where the default string dtype changed.
TEMPLATE_DTYPES: Dict[str, str] = {
    **{c: "object" for c in KEY_COLUMNS},
    **{c: "object" for c in ("crn", "client_name", "model_name", "client_dept",
                             "logged_team", "logged_office", "quarter", "source")},
    "is_main": "boolean",
    "aum": "Int64",
    "sleeve_weight_of_total": "float64",
    "sleeve_positions": "Int64",
    **{c: ("Int64" if c in _INT_FIELDS else "object" if c in _TEXT_FIELDS else "float64")
       for c in CHARACTERISTIC_COLUMNS + PERFORMANCE_COLUMNS},
    **{c: "float64" for c in BREAKDOWN_COLUMNS},
    **{c: "Int64" for c in NAMES_COLUMNS},
    "uploaded_at": "object",
}

#: What an empty cell of each dtype looks like. float64 takes NaN rather than pd.NA because
#: assigning pd.NA into a float64 column is a no-op in some pandas versions and an error in
#: others; NaN is the float blank everywhere.
_BLANK: Dict[str, Any] = {"float64": float("nan"), "Int64": pd.NA, "boolean": pd.NA, "object": None}


def template_columns(*, include_names: bool = False) -> List[str]:
    """
    Every column of a fill-in template, in order: key, context, characteristics,
    performance, breakdown buckets, optionally the counts, then `source`.

    `source` sits last because it is normally set once for a whole batch through
    `upload_frame(..., source=...)` rather than typed into the table.
    """
    columns = list(KEY_COLUMNS) + list(CONTEXT_COLUMNS)
    columns += list(CHARACTERISTIC_COLUMNS) + list(PERFORMANCE_COLUMNS)
    columns += list(BREAKDOWN_COLUMNS)
    if include_names:
        columns += list(NAMES_COLUMNS)
    columns.append("source")
    return columns


# =================================================================================
# Value conversion
# =================================================================================


def _scalar(value: Any) -> Any:
    """
    One cell, as a plain Python value — or None if it is blank in any of its spellings.

    Two jobs, both load-bearing. Missing is missing whether it arrives as None, NaN, NaT,
    `pd.NA` or an empty string, and all of them have to become the None the writer turns
    into SQL NULL. And a numpy scalar has to become a Python one: `db/writer._write_wide`
    binds values straight into sqlite3, which raises InterfaceError on a numpy.float64, and
    `validation/rules.py` tests holding counts with `isinstance(v, int)`, which a
    numpy.int64 fails. Neither of those is the writer's bug to fix — the conversion belongs
    at the boundary where pandas values enter the package, which is here.
    """
    if value is None:
        return None
    try:
        # pd.isna over a list or an array returns an array, not a bool. A cell holding one
        # is not missing; let validation judge whatever it is.
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, str):
        return value.strip() or None
    item = getattr(value, "item", None)
    return item() if callable(item) else value


def _text(value: Any) -> Optional[str]:
    """A cell as a stripped string, or None."""
    scalar = _scalar(value)
    if scalar is None:
        return None
    return str(scalar).strip() or None


def _as_int(value: Any, column: str) -> Optional[int]:
    """A cell as a whole number. Raises on a fractional one — 3184.5 securities is not a thing."""
    scalar = _scalar(value)
    if scalar is None:
        return None
    if isinstance(scalar, bool):
        raise ValueError(f"{column} is a boolean; expected a whole number.")
    if isinstance(scalar, int):
        return scalar
    try:
        number = float(scalar)
    except (TypeError, ValueError):
        raise ValueError(f"{column} is {scalar!r}; expected a whole number.") from None
    if abs(number - round(number)) > 1e-9:
        raise ValueError(f"{column} is {number}; expected a whole number.")
    return int(round(number))


def _as_float(value: Any, column: str) -> Optional[float]:
    scalar = _scalar(value)
    if scalar is None:
        return None
    if isinstance(scalar, bool):
        raise ValueError(f"{column} is a boolean; expected a number.")
    if isinstance(scalar, (int, float)):
        return float(scalar)
    try:
        return float(str(scalar).strip())
    except (TypeError, ValueError):
        raise ValueError(f"{column} is {scalar!r}; expected a number.") from None


def _as_of(value: Any) -> Optional[str]:
    """
    A cell as the ISO date the key wants.

    Accepts what people actually have: a Timestamp or date (the shape a CSV round trip
    produces), a `'Q1 2026'` label, or the ISO string itself. Anything else is passed
    through untouched so `validation/rules.py` can produce its own error, which names the
    field and suggests the fix — better than anything this function could raise.
    """
    scalar = _scalar(value)
    if scalar is None:
        return None
    if isinstance(scalar, (pd.Timestamp, datetime)):
        return scalar.date().isoformat()
    if isinstance(scalar, date):
        return scalar.isoformat()
    text = str(scalar).strip()
    if text.upper().startswith("Q"):
        try:
            return quarter_end_for_label(text)
        except ValueError:
            return text
    return text


def _as_of_list(value: Union[str, Iterable[str], None]) -> List[str]:
    """Normalize an `as_of=` argument to a list of ISO dates. None means the last quarter."""
    if value is None:
        return recent_quarter_ends(1)
    values = [value] if isinstance(value, (str, pd.Timestamp, datetime, date)) else list(value)
    return [d for d in (_as_of(v) for v in values) if d]


# =================================================================================
# Column classification
# =================================================================================


@dataclasses.dataclass(frozen=True)
class _Classified:
    """What each column of a frame is, worked out once before anything is opened."""

    characteristics: Tuple[str, ...] = ()
    performance: Tuple[str, ...] = ()
    #: dimension -> ((column, bucket), ...)
    weights: Dict[str, Tuple[Tuple[str, str], ...]] = dataclasses.field(default_factory=dict)
    counts: Dict[str, Tuple[Tuple[str, str], ...]] = dataclasses.field(default_factory=dict)
    has_source: bool = False

    @property
    def fillable(self) -> Tuple[str, ...]:
        """Every column an upload would read a value out of."""
        columns = list(self.characteristics) + list(self.performance)
        for group in (self.weights, self.counts):
            for entries in group.values():
                columns.extend(c for c, _ in entries)
        return tuple(columns)


def _suggest(column: str, known: Sequence[str]) -> str:
    close = difflib.get_close_matches(column, known, n=1, cutoff=0.7)
    if close:
        return f"{column!r} (did you mean {close[0]!r}?)"
    if SEP in column:
        dimension = column.split(SEP)[0]
        buckets = BREAKDOWN_DIMENSIONS.get(dimension)
        if buckets:
            return f"{column!r} ({dimension} buckets are: {', '.join(buckets)})"
    return repr(column)


def _classify(columns: Iterable[str]) -> _Classified:
    """
    Partition a frame's columns, rejecting anything unrecognized.

    Loud rejection is the entire justification for this layer. A silently dropped
    `price_to_books` is an upload that reports success and stores nothing — the exact
    failure `PortfolioData.from_dict` refuses one level down, applied to a table.
    """
    characteristics: List[str] = []
    performance: List[str] = []
    weights: Dict[str, List[Tuple[str, str]]] = {}
    counts: Dict[str, List[Tuple[str, str]]] = {}
    has_source = False
    unknown: List[str] = []

    known = list(template_columns(include_names=True))

    for column in columns:
        name = str(column)
        if name in KEY_COLUMNS or name in CONTEXT_COLUMNS or name.startswith("_"):
            continue
        if name == "uploaded_at":
            continue  # written by the database, carried by stored_frame, never uploaded
        if name == "source":
            has_source = True
        elif name in CHARACTERISTIC_COLUMNS:
            characteristics.append(name)
        elif name in PERFORMANCE_COLUMNS:
            performance.append(name)
        elif name in _BUCKET_OF:
            dimension, bucket = _BUCKET_OF[name]
            weights.setdefault(dimension, []).append((name, bucket))
        elif name.startswith(NAMES_PREFIX) and name[len(NAMES_PREFIX):] in _BUCKET_OF:
            dimension, bucket = _BUCKET_OF[name[len(NAMES_PREFIX):]]
            counts.setdefault(dimension, []).append((name, bucket))
        else:
            unknown.append(name)

    if unknown:
        raise ValueError(
            "Unknown column(s) in the frame: "
            + ", ".join(_suggest(u, known) for u in unknown)
            + ".\nContext columns are ignored rather than rejected: "
            + ", ".join(CONTEXT_COLUMNS)
            + ".\nPrefix a column with '_' to have it ignored too."
        )

    return _Classified(
        characteristics=tuple(characteristics),
        performance=tuple(performance),
        weights={d: tuple(v) for d, v in weights.items()},
        counts={d: tuple(v) for d, v in counts.items()},
        has_source=has_source,
    )


# =================================================================================
# Frame construction helpers
# =================================================================================


def _blank_frame(index: pd.Index, columns: Sequence[str]) -> pd.DataFrame:
    """An all-missing frame with this package's dtypes."""
    data = {}
    for column in columns:
        dtype = TEMPLATE_DTYPES.get(column, "object")
        data[column] = pd.Series(_BLANK[dtype], index=index, dtype=dtype)
    return pd.DataFrame(data, index=index)


def _apply_dtypes(df: pd.DataFrame) -> pd.DataFrame:
    """
    Put every known column back to its declared dtype.

    Needed after any `DataFrame.update` or `.loc` assignment: pandas upcasts an Int64
    column to float64 the moment a float touches it, and then every holding count in the
    frame reads as 3184.0.
    """
    for column in df.columns:
        dtype = TEMPLATE_DTYPES.get(str(column))
        if dtype is None or str(df[column].dtype) == dtype:
            continue
        try:
            df[column] = df[column].astype(dtype)
        except (TypeError, ValueError):
            # A cell that cannot hold its declared type is a data problem, and validation
            # says so much better than an astype traceback would. Leave it for the summary.
            pass
    return df


def _resolve_models(
    models: Union[pd.DataFrame, Sequence[LoggedModel], None],
    cfg: Optional[PortfolioConfig],
    **filters: Any,
) -> List[LoggedModel]:
    """Accept a models frame, a list of LoggedModel, or None (pull, applying the filters)."""
    if models is None:
        return get_models(cfg=cfg, **filters)
    if any(filters.values()):
        raise ValueError(
            "Pass either `models=` or the filters, not both — the filters are applied by "
            "get_models() when it pulls, and cannot be applied to models you already hold."
        )
    if isinstance(models, pd.DataFrame):
        column = "subject_id" if "subject_id" in models.columns else "id"
        if column not in models.columns:
            raise ValueError(
                "A models frame needs a `subject_id` column (models_frame() produces one)."
            )
        ids = [i for i in (_text(v) for v in models[column]) if i]
        # A models frame carries no holdings, so this is a re-read. One local SQLite query,
        # but a hidden one — do not put it inside a loop.
        return get_models(model_ids=ids, cfg=cfg) if ids else []
    return list(models)


# =================================================================================
# Pull
# =================================================================================


def models_frame(
    *,
    crn: Optional[str] = None,
    model_ids: Optional[Iterable[str]] = None,
    departments: Optional[Iterable[str]] = None,
    offices: Optional[Iterable[str]] = None,
    teams: Optional[Iterable[str]] = None,
    min_aum: Optional[int] = None,
    main_only: bool = False,
    logged_since: Optional[str] = None,
    models: Optional[Sequence[LoggedModel]] = None,
    cfg: Optional[PortfolioConfig] = None,
) -> pd.DataFrame:
    """
    One row per logged client model — who exists, how big, how many positions per sleeve.

    The filters are `get_models`' filters and behave identically: they AND together, and
    `min_aum` excludes a model whose AUM was never entered, because SQL leaves NULL out of
    every comparison.

        models_frame(departments=["Brokerage"], min_aum=1_000_000_000, main_only=True)

    `subject_id` is named for what it becomes: pass the frame straight to `blank_frame` and
    the ids carry through to the upload with no translation.
    """
    resolved = _resolve_models(
        models, cfg, crn=crn, model_ids=model_ids, departments=departments, offices=offices,
        teams=teams, min_aum=min_aum, main_only=main_only, logged_since=logged_since,
    )

    rows = [
        {
            "subject_id": m.id,
            "crn": m.crn,
            "client_name": m.client_name,
            "model_name": m.model_name,
            "is_main": m.is_main,
            "aum": m.aum,
            "client_dept": m.client_dept,
            "logged_team": m.logged_team,
            "logged_office": m.logged_office,
            "logged_at": m.logged_at,
            "source_engagement_id": m.source_engagement_id,
            "total_positions": len(m.total),
            "equity_positions": len(m.equity),
            "fixed_income_positions": len(m.fixed_income),
            "equity_weight_of_total": m.equity.weight_of_total,
            "fixed_income_weight_of_total": m.fixed_income.weight_of_total,
        }
        for m in resolved
    ]
    columns = [
        "subject_id", "crn", "client_name", "model_name", "is_main", "aum", "client_dept",
        "logged_team", "logged_office", "logged_at", "source_engagement_id",
        "total_positions", "equity_positions", "fixed_income_positions",
        "equity_weight_of_total", "fixed_income_weight_of_total",
    ]
    # Int64 rather than the float64 a None in the column would otherwise force: an AUM is
    # dollars and a position count is a count, and neither should render as 10000000.0.
    return _counts_as_int(pd.DataFrame(rows, columns=columns))


def _counts_as_int(frame: pd.DataFrame) -> pd.DataFrame:
    for column in ("aum", "source_engagement_id", "total_positions", "equity_positions",
                   "fixed_income_positions"):
        if column in frame.columns:
            frame[column] = frame[column].astype("Int64")
    return frame


def holdings_frame(
    models: Union[pd.DataFrame, Sequence[LoggedModel], None] = None,
    *,
    sleeves: Iterable[str] = PULLABLE_SLEEVES,
    cfg: Optional[PortfolioConfig] = None,
) -> pd.DataFrame:
    """
    One row per (model, sleeve, holding) — the positions themselves.

        equity = holdings_frame(models, sleeves=["equity"])
        tickers = equity.identifier.unique()          # hand this to a security master

    `weight` is within its sleeve and always sums to 1.0 per (model, sleeve).
    `weight_of_total` is that sleeve's share of the whole portfolio, and `portfolio_weight`
    is the two multiplied — the position's real weight in the client's book, precomputed
    because everyone needs it and it is easy to get backwards.

    Only `total`, `equity` and `fixed_income` can be pulled; the `equity_*` region sleeves
    are upload-only (a holding record carries no domicile to split on).
    """
    resolved = _resolve_models(models, cfg)
    wanted = list(sleeves)

    rows: List[Dict[str, Any]] = []
    for model in resolved:
        for name in wanted:
            if name not in PULLABLE_SLEEVES:
                raise ValueError(
                    f"{name!r} is upload-only and carries no holdings. Pullable sleeves: "
                    f"{', '.join(PULLABLE_SLEEVES)}."
                )
            sleeve = model.sleeve(name)
            for holding in sleeve.holdings:
                rows.append({
                    "subject_id": model.id,
                    "crn": model.crn,
                    "client_name": model.client_name,
                    "model_name": model.model_name,
                    "is_main": model.is_main,
                    "aum": model.aum,
                    "sleeve": name,
                    "weight_of_total": sleeve.weight_of_total,
                    "identifier": holding.identifier,
                    "constituent_type": holding.constituent_type,
                    "asset_class": holding.asset_class,
                    "weight": holding.weight,
                    "portfolio_weight": holding.weight * sleeve.weight_of_total,
                })

    columns = [
        "subject_id", "crn", "client_name", "model_name", "is_main", "aum", "sleeve",
        "weight_of_total", "identifier", "constituent_type", "asset_class", "weight",
        "portfolio_weight",
    ]
    return _counts_as_int(pd.DataFrame(rows, columns=columns))


# =================================================================================
# The template
# =================================================================================


def blank_frame(
    models: Union[pd.DataFrame, Sequence[LoggedModel], None] = None,
    *,
    sleeves: Iterable[str] = PULLABLE_SLEEVES,
    as_of: Union[str, Iterable[str], None] = None,
    include_benchmarks: bool = False,
    include_names: bool = False,
    only_populated_sleeves: bool = True,
    cfg: Optional[PortfolioConfig] = None,
) -> pd.DataFrame:
    """
    The fill-in template: one row per (subject, sleeve, as_of), every metric blank.

        tpl = blank_frame(models, sleeves=["equity"], as_of="Q1 2026")
        tpl.loc[tpl.subject_id == mid, "price_to_book"] = 2.87
        upload_frame(tpl, source="Morningstar Direct 2026-04-02")

    Args:
        models: A `models_frame`, a list of `LoggedModel`, or None to pull every model.
        sleeves: Defaults to total / equity / fixed_income. Add `equity_us`,
            `equity_developed` or `equity_em` if your engine splits the book by region —
            they are upload-only, so they get rows here but never appear in a pull.
        as_of: A quarter end, a `'Q1 2026'` label, or several (the rows multiply out).
            Defaults to the most recent completed quarter, which is the first entry in the
            dashboard's period dropdown.
        include_benchmarks: Add a row per (index, sleeve) as well. Off by default: the
            index numbers are identical for every client and are usually somebody else's
            job, so leaving them in would mean deleting the same rows every time.
        include_names: Add the 29 `names.dimension.bucket` holding-count columns.
        only_populated_sleeves: Skip a sleeve a model has no holdings in. A row for a bond
            sleeve that does not exist is a row nobody can fill.

    Returns:
        A `RangeIndex` frame — the key lives in columns, never the index, so
        `df.loc[mask, column] = value` works and a CSV round trip does not lose it.
    """
    resolved = _resolve_models(models, cfg)
    wanted = list(sleeves)
    unknown = [s for s in wanted if s not in SLEEVES]
    if unknown:
        raise ValueError(f"Unknown sleeve(s): {', '.join(unknown)}. Valid: {', '.join(SLEEVES)}")
    dates = _as_of_list(as_of)

    rows: List[Dict[str, Any]] = []
    for model in resolved:
        for name in wanted:
            sleeve = model.sleeve(name) if name in PULLABLE_SLEEVES else None
            if only_populated_sleeves and sleeve is not None and not sleeve:
                continue
            for when in dates:
                rows.append({
                    "subject_kind": SUBJECT_MODEL,
                    "subject_id": model.id,
                    "sleeve": name,
                    "as_of": when,
                    "crn": model.crn,
                    "client_name": model.client_name,
                    "model_name": model.model_name,
                    "is_main": model.is_main,
                    "aum": model.aum,
                    "client_dept": model.client_dept,
                    "logged_team": model.logged_team,
                    "logged_office": model.logged_office,
                    "quarter": _quarter_label(when),
                    "sleeve_weight_of_total": None if sleeve is None else sleeve.weight_of_total,
                    "sleeve_positions": None if sleeve is None else len(sleeve),
                })

    if include_benchmarks:
        for name in wanted:
            benchmark_id = SLEEVE_BENCHMARK.get(name)
            if not benchmark_id:
                continue
            for when in dates:
                rows.append({
                    "subject_kind": SUBJECT_BENCHMARK,
                    "subject_id": benchmark_id,
                    "sleeve": name,
                    "as_of": when,
                    "model_name": BENCHMARK_NAMES.get(benchmark_id, benchmark_id),
                    "quarter": _quarter_label(when),
                })

    return _template_from_rows(rows, include_names=include_names)


def _quarter_label(as_of: str) -> Optional[str]:
    try:
        return quarter_label(as_of)
    except ValueError:
        return None


#: Reading order for rows: the whole book, then the equity sleeve and its regional slices,
#: then the bonds. `SLEEVES` is not it — that tuple is grouped for validation, and putting
#: fixed_income above equity in a table people read top to bottom is just confusing.
_SLEEVE_DISPLAY_ORDER: Tuple[str, ...] = (
    "total", "equity", "equity_us", "equity_developed", "equity_em", "fixed_income",
)


def _sleeve_order(series: pd.Series) -> pd.Series:
    order = {name: i for i, name in enumerate(_SLEEVE_DISPLAY_ORDER)}
    return series.map(lambda s: order.get(s, len(order)))


def _template_from_rows(rows: Sequence[Dict[str, Any]], *, include_names: bool) -> pd.DataFrame:
    """Turn key+context dicts into a full-width template, sorted and blank everywhere else."""
    columns = template_columns(include_names=include_names)
    if not rows:
        return _blank_frame(pd.RangeIndex(0), columns)

    known = pd.DataFrame(rows)
    frame = _blank_frame(known.index, columns)
    for column in known.columns:
        if column in frame.columns:
            frame[column] = known[column]
    frame = _apply_dtypes(frame)

    frame = frame.sort_values(
        by=["subject_kind", "crn", "model_name", "sleeve", "as_of"],
        key=lambda s: _sleeve_order(s) if s.name == "sleeve" else s,
        na_position="last",
        kind="stable",
    ).reset_index(drop=True)
    return frame


# =================================================================================
# Filling
# =================================================================================


def _keyed(df: pd.DataFrame, what: str) -> pd.DataFrame:
    """A copy with all four key columns present and normalized, indexed by them."""
    out = df.copy()
    for column in KEY_COLUMNS:
        if column not in out.columns:
            if column == "subject_kind":
                out[column] = SUBJECT_MODEL
            else:
                raise ValueError(f"{what} has no {column!r} column; all of {', '.join(KEY_COLUMNS)} are needed.")
    out["subject_kind"] = [(_text(v) or SUBJECT_MODEL) for v in out["subject_kind"]]
    out["subject_id"] = [_text(v) for v in out["subject_id"]]
    out["sleeve"] = [_text(v) for v in out["sleeve"]]
    out["as_of"] = [_as_of(v) for v in out["as_of"]]
    return out


def fill(
    template: pd.DataFrame,
    values: pd.DataFrame,
    *,
    add_missing: bool = False,
) -> pd.DataFrame:
    """
    Copy every filled cell of `values` into `template`, matched on the four key columns.

        results = engine.run(...)            # your frame: the keys + whatever it computed
        tpl = fill(tpl, results)

    Blank cells in `values` are left alone, so two engines can fill the same template in
    either order. Returns a new frame; neither argument is modified.

    A key in `values` with no matching template row raises rather than being dropped —
    which is why this exists at all. `DataFrame.update` is index-aligned and silently
    ignores unmatched rows, so an off-by-one in a subject id produces a fill that changes
    nothing and says nothing. Pass `add_missing=True` to append those rows instead.
    """
    if not isinstance(template, pd.DataFrame) or not isinstance(values, pd.DataFrame):
        raise TypeError("fill() takes two DataFrames.")

    classified = _classify(values.columns)
    left = _keyed(template, "template").set_index(list(KEY_COLUMNS))
    right = _keyed(values, "values").set_index(list(KEY_COLUMNS))

    for frame, what in ((left, "template"), (right, "values")):
        duplicated = frame.index[frame.index.duplicated()]
        if len(duplicated):
            raise ValueError(
                f"{what} has {len(duplicated)} duplicate key row(s), e.g. {tuple(duplicated[0])}. "
                f"Each (subject_kind, subject_id, sleeve, as_of) may appear once."
            )

    unmatched = right.index.difference(left.index)
    if len(unmatched) and not add_missing:
        raise ValueError(
            f"{len(unmatched)} row(s) in `values` match no template row, e.g. "
            f"{tuple(unmatched[0])}. Pass add_missing=True to append them, or check the keys "
            f"— an unmatched key would otherwise be silently dropped."
        )
    if len(unmatched):
        extra = _blank_frame(unmatched, list(left.columns))
        left = pd.concat([left, extra])

    for column in classified.fillable + (("source",) if classified.has_source else ()):
        if column not in right.columns:
            continue
        if column not in left.columns:
            left[column] = _blank_frame(left.index, [column])[column]
        source = right[column]
        filled = source[source.notna()]
        if len(filled):
            left.loc[filled.index, column] = filled

    out = _apply_dtypes(left.reset_index())

    ordered = [c for c in template_columns(include_names=True) if c in out.columns]
    ordered += [c for c in out.columns if c not in ordered]
    return out[ordered]


# =================================================================================
# Push
# =================================================================================


def _row_to_payload(row: pd.Series, classified: _Classified, source: Optional[str]) -> PortfolioData:
    """One frame row as an upload record. Raises only on a value that cannot be a number."""
    characteristics: Dict[str, Any] = {}
    performance: Dict[str, Any] = {}

    for column in classified.characteristics:
        value = _convert(row[column], column)
        if value is not None:
            characteristics[column] = value
    for column in classified.performance:
        value = _convert(row[column], column)
        if value is not None:
            performance[column] = value

    breakdowns: List[Breakdown] = []
    for dimension, entries in classified.weights.items():
        weights = {}
        for column, bucket in entries:
            value = _as_float(row[column], column)
            if value is not None:
                weights[bucket] = value
        if not weights:
            # Not sent, so `_write_breakdowns` never deletes it: a dimension you left
            # entirely blank keeps whatever was stored for it.
            continue
        counts = {}
        for column, bucket in classified.counts.get(dimension, ()):
            value = _as_int(row[column], column)
            if value is not None:
                counts[bucket] = value
        breakdowns.append(Breakdown(dimension=dimension, weights=weights, names=counts))

    row_source = _text(row["source"]) if classified.has_source else None

    return PortfolioData(
        subject_id=_text(row["subject_id"]) or "",
        sleeve=_text(row["sleeve"]) or "",
        as_of=_as_of(row["as_of"]) or "",
        subject_kind=_text(row.get("subject_kind")) or SUBJECT_MODEL,
        characteristics=Characteristics(**characteristics) if characteristics else None,
        performance=Performance(**performance) if performance else None,
        breakdowns=breakdowns,
        source=row_source or source,
    )


def _convert(value: Any, column: str) -> Any:
    if column in _INT_FIELDS:
        return _as_int(value, column)
    if column in _TEXT_FIELDS:
        return _text(value)
    return _as_float(value, column)


def _check_structure(df: pd.DataFrame, classified: _Classified) -> None:
    """
    The problems worth refusing to start over, as opposed to reporting per row.

    A blank key, a duplicate key or a count with no weight beside it are all mistakes in how
    the *table* was built, and every one of them is silent if allowed through: a duplicate
    key upserts one row over another and reports two written, and `_write_breakdowns` looks
    counts up per weight bucket, so a count with no weight is dropped without a word.
    """
    missing_columns = [c for c in ("subject_id", "sleeve", "as_of") if c not in df.columns]
    if missing_columns:
        raise ValueError(
            f"The frame has no {', '.join(repr(c) for c in missing_columns)} column(s). "
            f"Every row needs {', '.join(KEY_COLUMNS)} — blank_frame() produces them."
        )

    keys = pd.DataFrame({
        "subject_kind": [(_text(v) or SUBJECT_MODEL) for v in
                         (df["subject_kind"] if "subject_kind" in df.columns else [None] * len(df))],
        "subject_id": [_text(v) for v in df["subject_id"]],
        "sleeve": [_text(v) for v in df["sleeve"]],
        "as_of": [_as_of(v) for v in df["as_of"]],
    }, index=df.index)

    blank = keys[keys.isna().any(axis=1)]
    if len(blank):
        positions = ", ".join(str(i) for i in list(blank.index[:5]))
        raise ValueError(
            f"{len(blank)} row(s) have a blank subject_id, sleeve or as_of (row {positions}). "
            f"A row with no key cannot be written or read back."
        )

    duplicated = keys[keys.duplicated(keep=False)]
    if len(duplicated):
        first = tuple(duplicated.iloc[0])
        raise ValueError(
            f"{len(duplicated)} row(s) share a key, e.g. {first}. Each "
            f"(subject_kind, subject_id, sleeve, as_of) may appear once — two rows with one "
            f"key would upsert over each other and still report two written."
        )

    orphan_counts: List[str] = []
    for dimension, entries in classified.counts.items():
        weight_columns = [c for c, _ in classified.weights.get(dimension, ())]
        for column, _bucket in entries:
            has_count = df[column].notna()
            has_weight = (
                df[weight_columns].notna().any(axis=1) if weight_columns
                else pd.Series(False, index=df.index)
            )
            if bool((has_count & ~has_weight).any()):
                orphan_counts.append(column)
    if orphan_counts:
        raise ValueError(
            f"Holding count(s) with no bucket weights beside them: {', '.join(orphan_counts)}. "
            f"A count is stored against its bucket's weight, so a count on a dimension you "
            f"left blank would be dropped silently. Fill the dimension's weights too, or "
            f"clear the counts."
        )


def upload_frame(
    df: pd.DataFrame,
    *,
    source: Optional[str] = None,
    strict: Optional[bool] = None,
    dry_run: bool = False,
    skip_blank_rows: bool = True,
    cfg: Optional[PortfolioConfig] = None,
) -> UploadSummary:
    """
    Write a filled template — characteristics, performance and breakdowns, one row at a time.

        summary = upload_frame(tpl, source="Morningstar Direct 2026-04-02", dry_run=True)
        print(summary.render())

    Every row becomes a `PortfolioData` and goes through `upload_pf_data`, so this is the
    existing pipeline with a different front end: the same validation matrix, the same
    verify-after-write, the same per-record isolation where one bad row is recorded and the
    batch continues.

    Args:
        source: Where the numbers came from. Fills only rows whose `source` cell is blank,
            so a per-row value always wins.
        strict: ERROR findings abort a record before its transaction opens. Defaults to
            `cfg.strict` (True).
        dry_run: Validate everything against live data and write nothing. Do this first.
        skip_blank_rows: Drop rows with nothing filled in before uploading, counting them
            as skipped. On by default because a template is mostly blank by construction,
            and 388 `payload_empty` warnings would bury the two findings that matter.

    Returns:
        An `UploadSummary` — counts, findings, `render()` for a human, and an `exit_code`.

    Raises:
        ValueError: for a problem with the table itself — an unknown column, a blank or
            duplicated key, a holding count with no weight beside it. Nothing is opened or
            written when it does; problems with the *values* are reported in the summary
            instead.
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"upload_frame() takes a DataFrame, got {type(df).__name__}.")

    classified = _classify(df.columns)
    _check_structure(df, classified)

    records: List[PortfolioData] = []
    failures: Dict[str, str] = {}
    blank = 0

    for _, row in df.iterrows():
        try:
            record = _row_to_payload(row, classified, source)
        except ValueError as exc:
            label = (
                f"{_text(row.get('subject_kind')) or SUBJECT_MODEL}:{_text(row['subject_id'])} / "
                f"{_text(row['sleeve'])} @ {_as_of(row['as_of'])}"
            )
            failures[label] = f"ValueError: {exc}"
            continue
        if record.is_empty and skip_blank_rows:
            blank += 1
            continue
        records.append(record)

    if blank:
        _log.info("%d row(s) had nothing filled in and were skipped.", blank)

    summary = upload_pf_data(records, strict=strict, dry_run=dry_run, cfg=cfg)

    # Fold the rows that never reached upload_pf_data back in, so the arithmetic in
    # render() still adds up to the number of rows the caller handed over.
    summary.total += blank + len(failures)
    summary.skipped += blank
    summary.failed += len(failures)
    summary.failures.update(failures)
    return summary


# =================================================================================
# Read back
# =================================================================================


def stored_frame(
    *,
    as_of: Union[str, Iterable[str], None] = None,
    subject_ids: Optional[Iterable[str]] = None,
    sleeves: Optional[Iterable[str]] = None,
    subject_kind: Optional[str] = None,
    include_names: bool = False,
    include_context: bool = True,
    cfg: Optional[PortfolioConfig] = None,
) -> pd.DataFrame:
    """
    What has already been uploaded, in exactly the template's shape.

        stored = stored_frame(as_of="Q1 2026")
        stored.notna().sum()          # coverage: how many models have each metric

    Column-identical to `blank_frame`, which makes the read-modify-write loop work:
    `upload_frame(stored_frame(...))` is a no-op round trip, so you can pull what is there,
    change three cells and send the whole thing back.

    Args:
        as_of: One quarter end, a `'Q1 2026'` label, or several. None reads every date.
        include_context: Join the client and model names back on. Costs one extra query.
    """
    resolved = resolve(cfg)
    dates = None if as_of is None else _as_of_list(as_of)
    ids = [i for i in (_text(v) for v in (subject_ids or ())) if i]

    characteristics, performance, breakdowns = read_stored(
        resolved,
        subject_kind=subject_kind,
        subject_ids=ids or None,
        sleeves=list(sleeves) if sleeves else None,
        as_of=dates,
    )

    columns = template_columns(include_names=include_names) + ["uploaded_at"]

    #: key -> the row being assembled
    assembled: Dict[Tuple[str, str, str, str], Dict[str, Any]] = {}

    def _slot(row: Dict[str, Any]) -> Dict[str, Any]:
        key = (row["subject_kind"], row["subject_id"], row["sleeve"], row["as_of"])
        slot = assembled.get(key)
        if slot is None:
            slot = dict(zip(KEY_COLUMNS, key))
            slot["quarter"] = _quarter_label(key[3])
            assembled[key] = slot
        # First writer wins for provenance: characteristics, then performance, then
        # breakdowns. They are usually one upload anyway, and picking a rule beats picking
        # whichever table the loop happened to read last.
        for field in ("source", "uploaded_at"):
            if row.get(field) is not None and slot.get(field) is None:
                slot[field] = row[field]
        return slot

    for row, names in ((characteristics, CHARACTERISTIC_COLUMNS), (performance, PERFORMANCE_COLUMNS)):
        for stored in row:
            slot = _slot(stored)
            for column in names:
                if stored.get(column) is not None:
                    slot[column] = stored[column]

    for stored in breakdowns:
        slot = _slot(stored)
        column = f"{stored['dimension']}{SEP}{stored['bucket']}"
        if column not in _BUCKET_OF:
            # A bucket that predates a vocabulary change. Surfacing it as an unknown column
            # would make the frame un-uploadable, so report it and move on.
            _log.warning("Stored bucket %r is not in the current vocabulary; not shown.", column)
            continue
        slot[column] = stored["weight"]
        if include_names and stored.get("names") is not None:
            slot[NAMES_PREFIX + column] = stored["names"]

    if not assembled:
        return _blank_frame(pd.RangeIndex(0), columns)

    known = pd.DataFrame(list(assembled.values()))
    frame = _blank_frame(known.index, columns)
    for column in known.columns:
        if column in frame.columns:
            frame[column] = known[column]

    if include_context:
        frame = _join_context(frame, cfg=cfg)

    frame = _apply_dtypes(frame)
    return frame.sort_values(
        by=["subject_kind", "crn", "model_name", "sleeve", "as_of"],
        key=lambda s: _sleeve_order(s) if s.name == "sleeve" else s,
        na_position="last",
        kind="stable",
    ).reset_index(drop=True)


def _join_context(frame: pd.DataFrame, *, cfg: Optional[PortfolioConfig]) -> pd.DataFrame:
    """Put the client and model names back onto rows whose subject is a model."""
    model_ids = [
        i for i in frame.loc[frame["subject_kind"] == SUBJECT_MODEL, "subject_id"].unique()
        if i
    ]
    context = {
        m.id: {
            "crn": m.crn, "client_name": m.client_name, "model_name": m.model_name,
            "is_main": m.is_main, "aum": m.aum, "client_dept": m.client_dept,
            "logged_team": m.logged_team, "logged_office": m.logged_office,
        }
        for m in (get_models(model_ids=model_ids, cfg=cfg) if model_ids else [])
    }

    for column in ("crn", "client_name", "model_name", "is_main", "aum", "client_dept",
                   "logged_team", "logged_office"):
        frame[column] = [
            context.get(sid, {}).get(column)
            if kind == SUBJECT_MODEL else (BENCHMARK_NAMES.get(sid) if column == "model_name" else None)
            for kind, sid in zip(frame["subject_kind"], frame["subject_id"])
        ]
    return frame


# =================================================================================
# Market series
# =================================================================================

_MARKET_COLUMNS = ("series", "tenor", "as_of", "value", "source")


def market_frame(
    *,
    series: Optional[Iterable[str]] = None,
    tenors: Optional[Iterable[str]] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    cfg: Optional[PortfolioConfig] = None,
) -> pd.DataFrame:
    """
    Stored market observations — Treasury par yields by tenor, credit spreads.

        have = set(market_frame(series=["ig_oas"]).as_of)     # what to backfill

    Not per-model and not per-sleeve, so these have their own pair of functions: a yield
    curve belongs to the market, not to anybody's portfolio.
    """
    points = get_market_series(series=series, tenors=tenors, start=start, end=end, cfg=cfg)
    rows = [
        {"series": p.series, "tenor": p.tenor, "as_of": p.as_of, "value": p.value, "source": p.source}
        for p in points
    ]
    return pd.DataFrame(rows, columns=list(_MARKET_COLUMNS))


def market_template(
    *,
    series: Iterable[str],
    as_of: Union[str, Iterable[str]],
    tenors: Optional[Iterable[str]] = None,
) -> pd.DataFrame:
    """
    A blank row for every (series, tenor, date) — fill in `value` and upload.

        curve = market_template(series=["ust_par_yield"], as_of="2026-03-31")
        curve.loc[curve.tenor == "10Y", "value"] = 0.0435      # 4.35%, as a fraction

    Tenors default to whatever the series declares, so `ust_par_yield` produces eleven rows
    a day and `ig_oas` produces one with `tenor=''` already correct. Unlike model data,
    these dates are not restricted to quarter ends.
    """
    listed = [s for s in series if s]
    unknown = [s for s in listed if s not in MARKET_SERIES]
    if unknown:
        raise ValueError(
            f"Unknown series: {', '.join(unknown)}. Valid: {', '.join(sorted(MARKET_SERIES))}."
        )
    dates = _as_of_list(as_of)

    rows = [
        {"series": name, "tenor": tenor, "as_of": when, "value": float("nan"), "source": None}
        for name in listed
        for tenor in (list(tenors) if tenors is not None else list(MARKET_SERIES[name]["tenors"]))
        for when in dates
    ]
    frame = pd.DataFrame(rows, columns=list(_MARKET_COLUMNS))
    if len(frame):
        frame["value"] = frame["value"].astype("float64")
    return frame


def upload_market_frame(
    df: pd.DataFrame,
    *,
    source: Optional[str] = None,
    strict: Optional[bool] = None,
    dry_run: bool = False,
    cfg: Optional[PortfolioConfig] = None,
) -> UploadSummary:
    """
    Write a filled market template. Rows with no `value` are skipped and reported.

    A blank `tenor` becomes `''` rather than NULL — it is part of the primary key, and
    SQLite allows NULLs there, so a NULL tenor would quietly let the same day be stored
    twice.
    """
    if not isinstance(df, pd.DataFrame):
        raise TypeError(f"upload_market_frame() takes a DataFrame, got {type(df).__name__}.")

    unknown = [
        str(c) for c in df.columns
        if str(c) not in _MARKET_COLUMNS and not str(c).startswith("_")
    ]
    if unknown:
        raise ValueError(
            f"Unknown column(s): {', '.join(repr(u) for u in unknown)}. A market frame has "
            f"{', '.join(_MARKET_COLUMNS)}. Prefix a column with '_' to have it ignored."
        )
    for required in ("series", "as_of", "value"):
        if required not in df.columns:
            raise ValueError(f"A market frame needs a {required!r} column.")

    points: List[MarketPoint] = []
    blank = 0
    failures: Dict[str, str] = {}

    for _, row in df.iterrows():
        name = _text(row["series"]) or ""
        when = _as_of(row["as_of"]) or ""
        tenor = _text(row["tenor"]) if "tenor" in df.columns else None
        label = f"{name}{f'[{tenor}]' if tenor else ''} @ {when}"
        try:
            value = _as_float(row["value"], "value")
        except ValueError as exc:
            failures[label] = f"ValueError: {exc}"
            continue
        if value is None:
            blank += 1
            continue
        points.append(MarketPoint(
            series=name,
            as_of=when,
            value=value,
            tenor=tenor or "",
            source=(_text(row["source"]) if "source" in df.columns else None) or source,
        ))

    if blank:
        _log.info("%d market row(s) had no value and were skipped.", blank)

    summary = upload_market_series(points, strict=strict, dry_run=dry_run, cfg=cfg)
    summary.total += blank + len(failures)
    summary.skipped += blank
    summary.failed += len(failures)
    summary.failures.update(failures)
    return summary


# =================================================================================
# Reporting
# =================================================================================


def findings_frame(summary: UploadSummary) -> pd.DataFrame:
    """
    An upload's findings as a table — easier to scan and group than `render()` when there
    are more than a handful.

        findings_frame(summary).groupby(["severity", "code"]).size()
    """
    rows = [
        {"severity": f.severity.value, "field": f.field, "code": f.code, "message": f.message}
        for f in summary.findings
    ]
    return pd.DataFrame(rows, columns=["severity", "field", "code", "message"])
