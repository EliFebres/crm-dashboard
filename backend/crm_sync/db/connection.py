"""
SQLite connection handling — and the three defaults in Python's `sqlite3` that would
otherwise quietly corrupt or deadlock this integration.

**1. Foreign keys are OFF by default.**
    better-sqlite3 turns them on (`PRAGMA foreign_keys = ON`, app/lib/db/connection.ts).
    Python does not. `engagements.client_crn` has a foreign key to `clients(crn)`; without
    the pragma, SQLite happily stores a CRN that matches no client. The dashboard resolves
    the client name through a LEFT JOIN, so that row renders with a blank client forever.
    We set the pragma on every connection.

**2. The implicit transaction is DEFERRED.**
    In its default `isolation_level=""` mode, Python opens a transaction before your first
    INSERT — a *deferred* one, which starts as a reader and tries to upgrade to a writer on
    the first write. Under WAL, if the Next.js server grabs the write lock in between, the
    upgrade cannot wait (SQLite returns SQLITE_BUSY immediately rather than deadlocking) and
    the transaction dies. We use `isolation_level=None` (autocommit) and issue an explicit
    `BEGIN IMMEDIATE`, taking the write lock up front so there is nothing to upgrade.

**3. `busy_timeout` is 5 seconds, not 0.**
    Matching the Node side means both processes wait the same amount for each other rather
    than one of them failing instantly.
"""

import random
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator, Optional, TypeVar

from ..config import TABLE_SYNC_KEYS, CrmConfig
from ..core.exceptions import DatabaseError, DatabaseLockedError, ForeignKeyError

T = TypeVar("T")


def _apply_pragmas(conn: sqlite3.Connection, cfg: CrmConfig, *, readonly: bool) -> None:
    """Bring a fresh connection in line with how the Node app opens the same file."""
    # foreign_keys is per-connection and OFF by default in Python. This is the important one.
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {int(cfg.busy_timeout_ms)}")
    if not readonly:
        # journal_mode is a persistent database property, so this is a no-op against a DB the
        # app already created. Stated anyway so a fresh file gets the mode the app expects.
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")


def open_engagements(cfg: CrmConfig) -> sqlite3.Connection:
    """Open engagements.sqlite for reading and writing, in autocommit mode."""
    conn = sqlite3.connect(str(cfg.engagements_db), isolation_level=None, timeout=cfg.busy_timeout_ms / 1000)
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn, cfg, readonly=False)
    return conn


def open_readonly(path: Path, cfg: CrmConfig) -> sqlite3.Connection:
    """
    Open a database file read-only, via a `file:...?mode=ro` URI.

    Used for `users.sqlite` (we only ever read the roster) and for the post-write
    verification pass. Opening read-only means a bug in this package cannot mutate the
    user table, and it makes the verification genuinely independent: it re-reads through a
    separate connection, proving the row is durable and visible to *other* processes —
    which is the whole point, since the dashboard is another process.
    """
    uri = f"{path.as_uri()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=cfg.busy_timeout_ms / 1000)
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn, cfg, readonly=True)
    return conn


@contextmanager
def write_tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Cursor]:
    """
    Run a block inside an explicit `BEGIN IMMEDIATE` transaction.

    IMMEDIATE takes the database's write lock at BEGIN rather than at the first write, so we
    never sit in the deferred-reader state that SQLITE_BUSYs when the Node server is mid-write.
    Commits on clean exit, rolls back on any exception.
    """
    cur = conn.cursor()
    cur.execute("BEGIN IMMEDIATE")
    try:
        yield cur
    except BaseException:
        try:
            cur.execute("ROLLBACK")
        except sqlite3.Error:
            pass  # already rolled back, or the connection is gone; the original error wins
        raise
    else:
        cur.execute("COMMIT")
    finally:
        cur.close()


def _is_locked_error(exc: sqlite3.OperationalError) -> bool:
    msg = str(exc).lower()
    return "database is locked" in msg or "database is busy" in msg


def run_with_retry(
    fn: Callable[[], T],
    cfg: CrmConfig,
    *,
    on_retry: Optional[Callable[[int, Exception], None]] = None,
) -> T:
    """
    Call `fn`, retrying with exponential backoff while SQLite reports a lock conflict.

    `fn` must be idempotent, because it may run more than once. The writer satisfies this by
    wrapping its *entire* transaction: a retry re-runs the dedupe check from scratch, so a
    partially-applied attempt can't double-insert (the rollback already undid it anyway).

    `busy_timeout` absorbs most contention on its own; this exists for the residue —
    `BEGIN IMMEDIATE` still failing after the timeout, and WAL checkpoint stalls.

    Raises:
        DatabaseLockedError: every attempt hit a lock.
        ForeignKeyError: an integrity error naming a FOREIGN KEY constraint.
        DatabaseError: any other sqlite3 error.
    """
    last: Optional[Exception] = None
    for attempt in range(cfg.retry_attempts):
        try:
            return fn()
        except sqlite3.OperationalError as exc:
            if not _is_locked_error(exc):
                raise DatabaseError(f"SQLite error: {exc}") from exc
            last = exc
            if attempt == cfg.retry_attempts - 1:
                break
            # Full jitter: spreads concurrent retriers instead of re-colliding in lockstep.
            delay = cfg.retry_base_delay * (2 ** attempt)
            time.sleep(random.uniform(0, delay))
            if on_retry:
                on_retry(attempt + 1, exc)
        except sqlite3.IntegrityError as exc:
            if "foreign key" in str(exc).lower():
                raise ForeignKeyError(
                    f"Foreign key constraint failed: {exc}. The engagement references a CRN "
                    f"with no row in `clients`."
                ) from exc
            raise DatabaseError(f"Integrity error: {exc}") from exc
        except sqlite3.Error as exc:
            raise DatabaseError(f"SQLite error: {exc}") from exc

    raise DatabaseLockedError(
        f"Database stayed locked across {cfg.retry_attempts} attempts "
        f"(busy_timeout={cfg.busy_timeout_ms}ms). Last error: {last}"
    )


def bootstrap_sync_tables(conn: sqlite3.Connection, cfg: CrmConfig) -> None:
    """
    Create the sidecar table crm_sync uses for idempotency. Safe to run on every startup.

    This table is owned entirely by this package. The Next.js app never reads, writes, or
    drops it — its own bootstrap only ever runs `CREATE TABLE IF NOT EXISTS` against tables
    it knows about, so an extra table alongside them is inert. That is why idempotency lives
    here rather than as a new column on `engagements`: no shared schema to migrate, and
    nothing for the app to trip over.

    Checks for the table with a plain read first, and only takes the write lock when it is
    genuinely absent. Otherwise every process start would need the write lock, and merely
    constructing a `CrmSync` would fail whenever the Next.js server happened to be mid-write.
    """
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (TABLE_SYNC_KEYS,)
    ).fetchone()
    if exists:
        return

    def _create() -> None:
        with write_tx(conn) as cur:
            cur.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {TABLE_SYNC_KEYS} (
                  sync_key      TEXT PRIMARY KEY,
                  engagement_id INTEGER NOT NULL,
                  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    run_with_retry(_create, cfg)
