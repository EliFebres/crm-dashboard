"""
The write transactions.

Two things here are worth understanding before editing.

**Partial updates must not erase.** A field left as None means "not measured", and is
written as SQL NULL. On a re-upload every value column updates through
`COALESCE(excluded.col, table.col)`, so a second pass carrying only performance leaves the
characteristics written by the first pass intact. Without that, the natural workflow —
characteristics from one export, returns from another — would silently blank half the row
each time. To deliberately clear a stored value, delete the row and re-upload it.

**Breakdowns are replaced, not merged.** Buckets carry no stable identity of their own, so
each dimension is deleted and reinserted wholesale within the same transaction — the same
choice `writeModel` makes for holdings in app/lib/db/portfolio.ts. Merging would leave a
bucket that disappeared upstream sitting in the table, still counted in the chart's total.
Replacement is scoped to the dimensions actually supplied: uploading a fresh `region` does
not touch a `credit_rating` written earlier.

Every record is one `BEGIN IMMEDIATE` transaction, wrapped in `run_with_retry`. IMMEDIATE
takes the write lock up front rather than upgrading from a reader mid-transaction, which
is what makes this safe to run while the Next.js server has the same file open — see
crm_sync/db/connection.py for the full account.
"""

import sqlite3
from typing import Dict, List, Optional, Sequence, Set, Tuple

from ..core.config import (
    SUBJECT_KEY_COLUMNS,
    TABLE_BREAKDOWNS,
    TABLE_CHARACTERISTICS,
    TABLE_MARKET_SERIES,
    TABLE_PERFORMANCE,
    PortfolioConfig,
)
from ..core.models import MarketPoint, PortfolioData
from .connection import run_with_retry, write_tx
from .schema import characteristic_columns, performance_columns

__all__ = ["write_payload", "write_market_points", "delete_subject", "prune_orphans"]

#: Chunk size for parameterized deletes. SQLite's compiled-in limit on bound variables is
#: 999 on older builds; staying well under it means a prune of ten thousand orphans works
#: everywhere rather than failing only on the machine with the older library.
_PARAM_CHUNK = 400


def _upsert_sql(table: str, value_columns: Sequence[str]) -> str:
    """
    Build the wide-table upsert. `source` rides along as a value column so it, too,
    survives a partial update rather than being nulled by a pass that omits it.
    """
    columns = list(SUBJECT_KEY_COLUMNS) + list(value_columns) + ["source"]
    placeholders = ", ".join("?" for _ in columns)
    updates = ", ".join(
        f"{c} = COALESCE(excluded.{c}, {table}.{c})" for c in list(value_columns) + ["source"]
    )
    return (
        f"INSERT INTO {table} ({', '.join(columns)}, uploaded_at) "
        f"VALUES ({placeholders}, CURRENT_TIMESTAMP) "
        f"ON CONFLICT({', '.join(SUBJECT_KEY_COLUMNS)}) DO UPDATE SET "
        f"{updates}, uploaded_at = CURRENT_TIMESTAMP"
    )


def _key_values(record: PortfolioData) -> List[object]:
    return [record.subject_kind, record.subject_id, record.sleeve, record.as_of]


def _write_wide(
    cur: sqlite3.Cursor,
    table: str,
    columns: Sequence[Tuple[str, str]],
    record: PortfolioData,
    payload: object,
) -> None:
    names = [name for name, _ in columns]
    values = [getattr(payload, name) for name in names]
    cur.execute(_upsert_sql(table, names), _key_values(record) + values + [record.source])


def _write_breakdowns(cur: sqlite3.Cursor, record: PortfolioData) -> None:
    key_where = " AND ".join(f"{c} = ?" for c in SUBJECT_KEY_COLUMNS)
    keys = _key_values(record)

    for breakdown in record.breakdowns:
        if not breakdown.weights:
            continue
        cur.execute(
            f"DELETE FROM {TABLE_BREAKDOWNS} WHERE {key_where} AND dimension = ?",
            keys + [breakdown.dimension],
        )
        for bucket, weight in breakdown.weights.items():
            names = breakdown.names.get(bucket)
            cur.execute(
                f"INSERT INTO {TABLE_BREAKDOWNS} "
                f"({', '.join(SUBJECT_KEY_COLUMNS)}, dimension, bucket, weight, names, source) "
                f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                keys + [
                    breakdown.dimension, bucket, float(weight),
                    None if names is None else int(names), record.source,
                ],
            )


def write_payload(conn: sqlite3.Connection, cfg: PortfolioConfig, record: PortfolioData) -> None:
    """
    Write one record's characteristics, performance and breakdowns atomically.

    Retried as a whole on lock contention, which is safe because the transaction is
    atomic and every statement in it is idempotent — a retry re-runs against a clean
    slate, since the rollback already undid the partial attempt.
    """

    def _run() -> None:
        with write_tx(conn) as cur:
            if record.characteristics is not None:
                _write_wide(cur, TABLE_CHARACTERISTICS, characteristic_columns(),
                            record, record.characteristics)
            if record.performance is not None:
                _write_wide(cur, TABLE_PERFORMANCE, performance_columns(),
                            record, record.performance)
            _write_breakdowns(cur, record)

    run_with_retry(_run, cfg.crm)


def write_market_points(
    conn: sqlite3.Connection, cfg: PortfolioConfig, points: Sequence[MarketPoint]
) -> None:
    """
    Upsert market observations. Unlike the payload tables there is nothing to preserve —
    a point is a single value, so a re-upload simply replaces it.
    """

    def _run() -> None:
        with write_tx(conn) as cur:
            for p in points:
                cur.execute(
                    f"INSERT INTO {TABLE_MARKET_SERIES} (series, tenor, as_of, value, source, uploaded_at) "
                    f"VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) "
                    f"ON CONFLICT(series, tenor, as_of) DO UPDATE SET "
                    f"value = excluded.value, "
                    f"source = COALESCE(excluded.source, {TABLE_MARKET_SERIES}.source), "
                    f"uploaded_at = CURRENT_TIMESTAMP",
                    (p.series, p.tenor, p.as_of, float(p.value), p.source),
                )

    run_with_retry(_run, cfg.crm)


_DATA_TABLES = (TABLE_CHARACTERISTICS, TABLE_PERFORMANCE, TABLE_BREAKDOWNS)


def delete_subject(
    conn: sqlite3.Connection,
    cfg: PortfolioConfig,
    subject_id: str,
    *,
    subject_kind: str = "model",
    sleeve: Optional[str] = None,
    as_of: Optional[str] = None,
) -> int:
    """
    Remove stored data for a subject, optionally narrowed to one sleeve and/or date.

    Used by the smoke test to clean up after itself, and by hand when a batch has to be
    withdrawn. Returns the number of rows deleted across all three tables.
    """
    conditions = ["subject_kind = ?", "subject_id = ?"]
    params: List[object] = [subject_kind, subject_id]
    if sleeve:
        conditions.append("sleeve = ?")
        params.append(sleeve)
    if as_of:
        conditions.append("as_of = ?")
        params.append(as_of)
    where = " AND ".join(conditions)

    deleted = 0

    def _run() -> None:
        nonlocal deleted
        with write_tx(conn) as cur:
            for table in _DATA_TABLES:
                cur.execute(f"DELETE FROM {table} WHERE {where}", params)
                deleted += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

    run_with_retry(_run, cfg.crm)
    return deleted


def prune_orphans(
    conn: sqlite3.Connection,
    cfg: PortfolioConfig,
    live_model_ids: Set[str],
    *,
    dry_run: bool = True,
) -> Dict[str, int]:
    """
    Find (and optionally delete) stored data for models that no longer exist.

    This is the reconciliation point the schema cannot provide. `subject_id` references
    `client_models`, which lives in a different file — SQLite cannot enforce a foreign key
    across files, so a model deleted in the dashboard leaves its analytics behind. Left
    alone they inflate every rollup that counts rows, quietly and forever.

    Defaults to a dry run: it reports what it would remove and touches nothing. Benchmark
    subjects are never considered orphans; they have no model row by design.

    Returns `{table: row_count}` for the rows found (dry run) or deleted.
    """
    orphans: Set[str] = set()
    for table in _DATA_TABLES:
        rows = conn.execute(
            f"SELECT DISTINCT subject_id FROM {table} WHERE subject_kind = 'model'"
        ).fetchall()
        orphans.update(r[0] for r in rows if r[0] not in live_model_ids)

    counts: Dict[str, int] = {t: 0 for t in _DATA_TABLES}
    if not orphans:
        return counts

    ordered = sorted(orphans)
    # Count first, so a dry run and a real run report the same number.
    for table in _DATA_TABLES:
        for i in range(0, len(ordered), _PARAM_CHUNK):
            chunk = ordered[i:i + _PARAM_CHUNK]
            placeholders = ", ".join("?" for _ in chunk)
            row = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE subject_kind = 'model' "
                f"AND subject_id IN ({placeholders})",
                chunk,
            ).fetchone()
            counts[table] += int(row[0])

    if dry_run:
        return counts

    def _run() -> None:
        with write_tx(conn) as cur:
            for table in _DATA_TABLES:
                for i in range(0, len(ordered), _PARAM_CHUNK):
                    chunk = ordered[i:i + _PARAM_CHUNK]
                    placeholders = ", ".join("?" for _ in chunk)
                    cur.execute(
                        f"DELETE FROM {table} WHERE subject_kind = 'model' "
                        f"AND subject_id IN ({placeholders})",
                        chunk,
                    )

    run_with_retry(_run, cfg.crm)
    return counts
