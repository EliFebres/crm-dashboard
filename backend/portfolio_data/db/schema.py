"""
The sidecar tables, and why they can live in a file the app already owns.

`portfolio.sqlite` is created and maintained by the Next.js side (app/lib/db/portfolio.ts),
which bootstraps `portfolio_models` and `portfolio_holdings` on every open. Its bootstrap
runs `CREATE TABLE IF NOT EXISTS` against exactly the tables it knows about and nothing
else, so five extra tables sitting beside them are inert — it will never drop them, never
migrate them, and never notice them. That is the same arrangement crm_sync uses for
`crm_sync_keys` in engagements.sqlite, and it is what makes "add analytics without touching
the app's schema" possible.

The three data tables share one key: (subject_kind, subject_id, sleeve, as_of).

  subject_kind  'model' | 'benchmark'
  subject_id    client_models.id, or a benchmark id like 'MSCI-ACWI-IMI'
  sleeve        'total' | 'equity' | 'fixed_income'
  as_of         a quarter-end ISO date

Benchmarks share the tables with models rather than getting their own, because every card
on the Portfolio Trends page is captioned "vs <index>". Storing the index somewhere else
would turn every comparison into a second query and a join across two shapes; storing it
here makes "the model and its benchmark at this quarter end" one `WHERE subject_id IN (...)`.

There is deliberately no foreign key to `portfolio_models`. `subject_id` is a
`client_models` id (which lives in a *different file* — SQLite cannot enforce a foreign key
across files) and benchmark rows have no model row at all. `prune_orphans` in push.py is
the reconciliation point instead.

## Wide columns

`pf_characteristics` and `pf_performance` are wide: one typed column per metric. The column
lists are not written out here — they are reflected from the dataclasses in
core/models.py by `payload_columns`, so adding a field to `Characteristics` adds the column
and its upsert slot with no second edit. A hand-kept list beside the dataclass drifts, and
the symptom of drift is an upload that accepts a value and silently never stores it.

`pf_breakdowns` is the exception: a distribution is naturally (dimension, bucket, weight),
the bucket set differs per dimension and grows, and a 9-cell style box would otherwise be
nine columns that mean nothing to any other dimension.
"""

import sqlite3
from typing import List, Tuple

from ..core.config import (
    SUBJECT_KEY_COLUMNS,
    TABLE_BENCHMARKS,
    TABLE_BREAKDOWNS,
    TABLE_CHARACTERISTICS,
    TABLE_MARKET_SERIES,
    TABLE_PERFORMANCE,
    PortfolioConfig,
)
from ..core.models import Characteristics, Performance, payload_columns
from ..validation.vocabulary import SEED_BENCHMARKS
from .connection import run_with_retry, write_tx

__all__ = [
    "bootstrap",
    "characteristic_columns",
    "performance_columns",
    "ALL_TABLES",
]

ALL_TABLES = (
    TABLE_CHARACTERISTICS,
    TABLE_PERFORMANCE,
    TABLE_BREAKDOWNS,
    TABLE_BENCHMARKS,
    TABLE_MARKET_SERIES,
)

#: The shared key, spelled once as SQL.
_KEY_DDL = """
      subject_kind TEXT NOT NULL,
      subject_id   TEXT NOT NULL,
      sleeve       TEXT NOT NULL,
      as_of        TEXT NOT NULL,
"""

#: Provenance carried by every uploaded row. `source` names where the numbers came from,
#: so a batch that turns out to be wrong can be found and re-pulled rather than guessed at.
_PROVENANCE_DDL = """
      source       TEXT,
      uploaded_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
"""


def characteristic_columns() -> List[Tuple[str, str]]:
    """`(name, sql_type)` for every metric on `Characteristics`."""
    return payload_columns(Characteristics)


def performance_columns() -> List[Tuple[str, str]]:
    """`(name, sql_type)` for every metric on `Performance`."""
    return payload_columns(Performance)


def _wide_table_ddl(table: str, columns: List[Tuple[str, str]]) -> str:
    body = "".join(f"      {name:<24} {sql_type},\n" for name, sql_type in columns)
    return f"""
    CREATE TABLE IF NOT EXISTS {table} (
{_KEY_DDL.rstrip()}
{body.rstrip()}
{_PROVENANCE_DDL.rstrip()}
      PRIMARY KEY ({", ".join(SUBJECT_KEY_COLUMNS)})
    );
    """


def _ddl_statements() -> List[str]:
    """Every CREATE this package needs. All idempotent, so re-running is free."""
    statements = [
        _wide_table_ddl(TABLE_CHARACTERISTICS, characteristic_columns()),
        _wide_table_ddl(TABLE_PERFORMANCE, performance_columns()),
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_BREAKDOWNS} (
{_KEY_DDL.rstrip()}
          dimension    TEXT NOT NULL,
          bucket       TEXT NOT NULL,
          weight       REAL NOT NULL,
{_PROVENANCE_DDL.rstrip()}
          PRIMARY KEY ({", ".join(SUBJECT_KEY_COLUMNS)}, dimension, bucket)
        );
        """,
        # Registry, not a data table: what a benchmark id means and which sleeve it
        # benchmarks. Validation refuses a benchmark upload whose id is not in here, so
        # a typo'd index cannot quietly become a subject nothing compares against.
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_BENCHMARKS} (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          sleeve      TEXT NOT NULL,
          is_default  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """,
        # Market-level series: no subject, no sleeve. `tenor` is NOT NULL DEFAULT ''
        # rather than nullable because it is part of the primary key, and SQLite permits
        # NULLs in primary key columns — a NULL tenor would silently defeat uniqueness
        # and let the same day be inserted over and over.
        f"""
        CREATE TABLE IF NOT EXISTS {TABLE_MARKET_SERIES} (
          series      TEXT NOT NULL,
          tenor       TEXT NOT NULL DEFAULT '',
          as_of       TEXT NOT NULL,
          value       REAL NOT NULL,
          source      TEXT,
          uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (series, tenor, as_of)
        );
        """,
    ]

    # The dashboard's read is "every model's <sleeve> at <quarter end>", which leads with
    # subject_kind and sleeve and scans as_of — so that is the index order.
    for table in (TABLE_CHARACTERISTICS, TABLE_PERFORMANCE, TABLE_BREAKDOWNS):
        statements.append(
            f"CREATE INDEX IF NOT EXISTS idx_{table}_scan "
            f"ON {table} (subject_kind, sleeve, as_of);"
        )
    statements.append(
        f"CREATE INDEX IF NOT EXISTS idx_{TABLE_BREAKDOWNS}_dim "
        f"ON {TABLE_BREAKDOWNS} (dimension, bucket);"
    )
    statements.append(
        f"CREATE INDEX IF NOT EXISTS idx_{TABLE_MARKET_SERIES}_series "
        f"ON {TABLE_MARKET_SERIES} (series, as_of);"
    )
    return statements


def _missing_tables(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN "
        f"({', '.join('?' for _ in ALL_TABLES)})",
        ALL_TABLES,
    ).fetchall()
    present = {r[0] for r in rows}
    return [t for t in ALL_TABLES if t not in present]


def bootstrap(conn: sqlite3.Connection, cfg: PortfolioConfig) -> None:
    """
    Create the sidecar tables and seed the known benchmarks. Safe on every startup.

    Checks with a plain read first and only takes the write lock when something is
    genuinely absent — the same trick as `bootstrap_sync_tables` in crm_sync, and for the
    same reason: otherwise every process start would need the write lock, and merely
    calling `get_models()` would fail whenever the Next.js server happened to be
    mid-write.
    """
    if not _missing_tables(conn):
        return

    def _create() -> None:
        with write_tx(conn) as cur:
            for statement in _ddl_statements():
                cur.execute(statement)
            for benchmark_id, name, sleeve, is_default in SEED_BENCHMARKS:
                # OR IGNORE: a benchmark someone renamed or re-pointed by hand stays as
                # they left it. Seeding is a convenience, not an authority.
                cur.execute(
                    f"INSERT OR IGNORE INTO {TABLE_BENCHMARKS} (id, name, sleeve, is_default) "
                    f"VALUES (?, ?, ?, ?)",
                    (benchmark_id, name, sleeve, 1 if is_default else 0),
                )

    run_with_retry(_create, cfg.crm)
