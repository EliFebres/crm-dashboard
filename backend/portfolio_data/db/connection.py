"""
Opening the two database files, and the one place this package couples to crm_sync.

Nothing here is novel. `crm_sync/db/connection.py` already documents — and works around —
the three `sqlite3` defaults that would otherwise corrupt or deadlock a Python process
sharing these files with the Next.js server:

  1. foreign keys are OFF by default, where better-sqlite3 turns them ON
  2. the implicit transaction is DEFERRED, which SQLITE_BUSYs under WAL when the server
     takes the write lock mid-upgrade; we use autocommit + explicit BEGIN IMMEDIATE
  3. busy_timeout defaults to 0 rather than the 5s the Node side waits

Read that module's docstring for the full reasoning. This one only adds the two paths
crm_sync has no opinion about: `portfolio.sqlite` opened for writing, and
`engagements.sqlite` opened read-only.

Engagements is deliberately read-only here. This package pulls models from it and pushes
nowhere near it, so opening it read-only makes that structural rather than a convention a
future edit could quietly break.
"""

import sqlite3

# Reused wholesale — see the module docstring. `_apply_pragmas` is private to crm_sync but
# both packages ship from the same distribution (backend/pyproject.toml), and reaching for
# it is strictly better than maintaining a second copy of the pragma set that could drift
# from the one the CRM writer uses.
from crm_sync.db.connection import _apply_pragmas, open_readonly, run_with_retry, write_tx

from ..core.config import PortfolioConfig

__all__ = [
    "open_portfolio",
    "open_portfolio_readonly",
    "open_engagements_readonly",
    "write_tx",
    "run_with_retry",
]


def open_portfolio(cfg: PortfolioConfig) -> sqlite3.Connection:
    """Open portfolio.sqlite for reading and writing, in autocommit mode."""
    conn = sqlite3.connect(
        str(cfg.portfolio_db),
        isolation_level=None,
        timeout=cfg.crm.busy_timeout_ms / 1000,
    )
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn, cfg.crm, readonly=False)
    return conn


def open_portfolio_readonly(cfg: PortfolioConfig) -> sqlite3.Connection:
    """
    Open portfolio.sqlite read-only, through a `file:...?mode=ro` URI.

    Used by post-write verification, where a separate read-only connection is the entire
    point: it proves the row is durable and visible to *other* processes, which is what
    the Next.js server is.
    """
    return open_readonly(cfg.portfolio_db, cfg.crm)


def open_engagements_readonly(cfg: PortfolioConfig) -> sqlite3.Connection:
    """Open engagements.sqlite read-only. This package never writes to it."""
    return open_readonly(cfg.engagements_db, cfg.crm)
