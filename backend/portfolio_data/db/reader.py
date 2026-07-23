"""
Reads: logged models out of engagements.sqlite, everything else out of portfolio.sqlite.

## Why models come from engagements.sqlite

`client_models` is the source of truth. `portfolio.sqlite`'s `portfolio_models` is a
denormalized projection of it, rebuilt by `npm run sync:portfolio` and stale in between —
app/lib/db/portfolioSync.ts says so outright ("It is currently the only writer, so
portfolio.sqlite is stale between runs"). A pull that fed an analytics run from the
projection would silently analyse whatever the world looked like at the last sync, which
for a model logged this morning means analysing nothing at all.

So we read the source and accept the cost: holdings arrive as a JSON blob that has to be
parsed, and the filter columns (department, office, team) have to be joined in rather than
read off the row. The join below is the same one `syncPortfolioModels` uses, so a model
pulled here and the same model synced there resolve their department and office
identically.

Uploads still land in portfolio.sqlite — that is where the dashboard reads, and
`portfolio_models.id` reuses `client_models.id`, so the ids line up with no translation.
"""

import sqlite3
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from ..core.config import (
    SUBJECT_KEY_COLUMNS,
    TABLE_BENCHMARKS,
    TABLE_BREAKDOWNS,
    TABLE_CHARACTERISTICS,
    TABLE_CLIENT_MODELS,
    TABLE_MARKET_SERIES,
    TABLE_PERFORMANCE,
    PortfolioConfig,
)
from ..core.models import Breakdown, LoggedModel, MarketPoint
from ..core.sleeves import build_sleeves
from .connection import open_engagements_readonly, open_portfolio_readonly

__all__ = [
    "read_models",
    "load_known_subjects",
    "read_market_series",
    "read_characteristics",
    "read_performance",
    "read_breakdowns",
]

#: Mirrors the SELECT in syncPortfolioModels (app/lib/db/portfolioSync.ts). The LEFT JOIN
#: on engagements is what carries department / team / office onto the model; it is a LEFT
#: join because `logged_engagement_id` is nullable — a model saved from Settings has no
#: originating interaction, and must still be pullable.
_MODELS_SQL = f"""
SELECT cm.id, cm.crn, c.name AS client_name, cm.name AS model_name,
       cm.is_main, cm.aum, cm.holdings, cm.updated_at, cm.logged_engagement_id,
       e.team, e.internal_client_dept, e.office
  FROM {TABLE_CLIENT_MODELS} cm
  JOIN clients c          ON c.crn = cm.crn
  LEFT JOIN engagements e ON e.id  = cm.logged_engagement_id
"""


def _in_clause(column: str, values: Sequence[str]) -> Tuple[str, List[str]]:
    placeholders = ", ".join("?" for _ in values)
    return f"{column} IN ({placeholders})", list(values)


def read_models(
    cfg: PortfolioConfig,
    *,
    crn: Optional[str] = None,
    model_ids: Optional[Iterable[str]] = None,
    departments: Optional[Iterable[str]] = None,
    offices: Optional[Iterable[str]] = None,
    teams: Optional[Iterable[str]] = None,
    min_aum: Optional[int] = None,
    main_only: bool = False,
    logged_since: Optional[str] = None,
) -> List[LoggedModel]:
    """
    Load models matching every supplied filter (they AND together). No filters: everything.

    `min_aum` is a strict lower bound in dollars, matching the dashboard's "over $1B"
    semantics — and, as there, a model whose AUM was never entered satisfies no threshold
    at all, because SQL's NULL comparison excludes it. That exclusion is silent by nature,
    so `get_models` reports the count separately rather than letting it read as
    "nothing matched".
    """
    conditions: List[str] = []
    params: List[object] = []

    if crn:
        conditions.append("cm.crn = ?")
        params.append(crn)
    for column, values in (
        ("cm.id", model_ids),
        ("e.internal_client_dept", departments),
        ("e.office", offices),
        ("e.team", teams),
    ):
        listed = [v for v in (values or ()) if v]
        if listed:
            clause, bound = _in_clause(column, listed)
            conditions.append(clause)
            params.extend(bound)
    if min_aum is not None:
        conditions.append("cm.aum > ?")
        params.append(min_aum)
    if main_only:
        conditions.append("cm.is_main = 1")
    if logged_since:
        # updated_at is an ISO string, so a string comparison sorts correctly.
        conditions.append("cm.updated_at >= ?")
        params.append(logged_since)

    sql = _MODELS_SQL
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY cm.crn, cm.sort_order"

    conn = open_engagements_readonly(cfg)
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()

    return [_row_to_model(r) for r in rows]


def _row_to_model(r: sqlite3.Row) -> LoggedModel:
    total, equity, fixed_income = build_sleeves(r["holdings"])
    return LoggedModel(
        id=r["id"],
        crn=r["crn"],
        client_name=r["client_name"],
        model_name=r["model_name"],
        is_main=bool(r["is_main"]),
        aum=None if r["aum"] is None else int(r["aum"]),
        client_dept=r["internal_client_dept"],
        logged_team=r["team"],
        logged_office=r["office"],
        # Current-state store: when the model was last logged, not a point-in-time
        # snapshot. Same meaning `loggedAt` carries in portfolioSync.ts.
        logged_at=r["updated_at"],
        source_engagement_id=r["logged_engagement_id"],
        total=total,
        equity=equity,
        fixed_income=fixed_income,
    )


def load_known_subjects(cfg: PortfolioConfig) -> Tuple[Set[str], Dict[str, str]]:
    """
    Snapshot of what an upload is allowed to reference: live model ids, and the benchmark
    registry as `{id: sleeve}`.

    Loaded once per upload call rather than checked per record — an upload of a thousand
    rows should cost one query, not a thousand, and a model deleted midway through a batch
    is a race no per-row check would win anyway.
    """
    eng = open_engagements_readonly(cfg)
    try:
        model_ids = {r[0] for r in eng.execute(f"SELECT id FROM {TABLE_CLIENT_MODELS}")}
    finally:
        eng.close()

    pf = open_portfolio_readonly(cfg)
    try:
        benchmarks = {r[0]: r[1] for r in pf.execute(f"SELECT id, sleeve FROM {TABLE_BENCHMARKS}")}
    finally:
        pf.close()

    return model_ids, benchmarks


def _key_where(subject_kind: str, subject_id: str, sleeve: str, as_of: str) -> Tuple[str, List[str]]:
    return (
        " AND ".join(f"{c} = ?" for c in SUBJECT_KEY_COLUMNS),
        [subject_kind, subject_id, sleeve, as_of],
    )


def _read_wide(
    conn: sqlite3.Connection, table: str, subject_kind: str, subject_id: str, sleeve: str, as_of: str
) -> Optional[sqlite3.Row]:
    where, params = _key_where(subject_kind, subject_id, sleeve, as_of)
    return conn.execute(f"SELECT * FROM {table} WHERE {where}", params).fetchone()


def read_characteristics(
    cfg: PortfolioConfig, subject_id: str, sleeve: str, as_of: str, subject_kind: str = "model"
) -> Optional[Dict[str, object]]:
    """Read one characteristics row back as a plain dict, or None."""
    conn = open_portfolio_readonly(cfg)
    try:
        row = _read_wide(conn, TABLE_CHARACTERISTICS, subject_kind, subject_id, sleeve, as_of)
        return dict(row) if row else None
    finally:
        conn.close()


def read_performance(
    cfg: PortfolioConfig, subject_id: str, sleeve: str, as_of: str, subject_kind: str = "model"
) -> Optional[Dict[str, object]]:
    """Read one performance row back as a plain dict, or None."""
    conn = open_portfolio_readonly(cfg)
    try:
        row = _read_wide(conn, TABLE_PERFORMANCE, subject_kind, subject_id, sleeve, as_of)
        return dict(row) if row else None
    finally:
        conn.close()


def read_breakdowns(
    cfg: PortfolioConfig, subject_id: str, sleeve: str, as_of: str, subject_kind: str = "model"
) -> List[Breakdown]:
    """Read every stored breakdown for one key, reassembled into `Breakdown` objects."""
    where, params = _key_where(subject_kind, subject_id, sleeve, as_of)
    conn = open_portfolio_readonly(cfg)
    try:
        rows = conn.execute(
            f"SELECT dimension, bucket, weight, names FROM {TABLE_BREAKDOWNS} WHERE {where} "
            f"ORDER BY dimension, bucket",
            params,
        ).fetchall()
    finally:
        conn.close()

    grouped: Dict[str, Dict[str, float]] = {}
    counts: Dict[str, Dict[str, int]] = {}
    for r in rows:
        grouped.setdefault(r["dimension"], {})[r["bucket"]] = float(r["weight"])
        if r["names"] is not None:
            counts.setdefault(r["dimension"], {})[r["bucket"]] = int(r["names"])
    return [
        Breakdown(dimension=d, weights=w, names=counts.get(d, {}))
        for d, w in grouped.items()
    ]


def read_market_series(
    cfg: PortfolioConfig,
    *,
    series: Optional[Iterable[str]] = None,
    tenors: Optional[Iterable[str]] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> List[MarketPoint]:
    """Load stored market points, oldest first. Filters AND together; none means all."""
    conditions: List[str] = []
    params: List[object] = []

    listed_series = [s for s in (series or ()) if s]
    if listed_series:
        clause, bound = _in_clause("series", listed_series)
        conditions.append(clause)
        params.extend(bound)
    # A tenor of '' is meaningful (a series with no term structure), so filter on
    # `is not None` rather than truthiness — `if t` would silently drop it.
    listed_tenors = [t for t in (tenors or ()) if t is not None]
    if listed_tenors:
        clause, bound = _in_clause("tenor", listed_tenors)
        conditions.append(clause)
        params.extend(bound)
    if start:
        conditions.append("as_of >= ?")
        params.append(start)
    if end:
        conditions.append("as_of <= ?")
        params.append(end)

    sql = f"SELECT series, tenor, as_of, value, source FROM {TABLE_MARKET_SERIES}"
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY series, as_of, tenor"

    conn = open_portfolio_readonly(cfg)
    try:
        rows = conn.execute(sql, params).fetchall()
    finally:
        conn.close()

    return [
        MarketPoint(
            series=r["series"],
            as_of=r["as_of"],
            value=float(r["value"]),
            tenor=r["tenor"],
            source=r["source"],
        )
        for r in rows
    ]
