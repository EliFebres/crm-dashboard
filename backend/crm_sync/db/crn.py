"""
CRN (Client Reference Number) helpers — a line-for-line port of app/lib/config/crn.ts.

The CRN is the canonical identity of an external client. Two ways it gets assigned:

  * autoGenerate = False (the current setting) — a human types the client's real CRN from
    whatever upstream system owns it. If they don't know it yet, the client can be registered
    with a `PENDING-000001` placeholder and flagged so the UI nags for the real value later.
  * autoGenerate = True — the app hands out the next CRN from a counter table.

Both generators MUST be called from inside an open `BEGIN IMMEDIATE` transaction. The
TypeScript versions carry the same requirement (they take a `Tx` handle and say so): the
read-then-insert is only atomic because the write lock is already held. Calling them in
autocommit mode would let two processes reserve the same CRN.

Keep this file in sync with crn.ts by hand.
"""

import sqlite3

from ..config import CRN_PATTERN, PENDING_CRN_PREFIX, TABLE_CLIENTS, TABLE_CRN_SEQUENCE, CrmConfig


def normalize_crn(raw: str) -> str:
    """
    Trim and uppercase, so CRNs compare case-insensitively against the primary key.

    `clients.crn` is a plain TEXT PRIMARY KEY (case-sensitive), and the app only ever stores
    normalized values — so normalizing on the way in is what makes 'crn-42' find 'CRN-42'.
    """
    return raw.strip().upper()


def is_valid_crn(crn: str) -> bool:
    """True when an already-normalized CRN matches the configured shape."""
    return bool(CRN_PATTERN.match(crn))


def is_pending_crn(crn: str) -> bool:
    """True when `crn` is a system-generated placeholder still awaiting its real value."""
    return crn.upper().startswith(PENDING_CRN_PREFIX)


def generate_pending_crn(cur: sqlite3.Cursor) -> str:
    """
    Reserve and return the next placeholder CRN: PENDING-000001, PENDING-000002, ...

    Must run inside `BEGIN IMMEDIATE`. Scans for the highest existing placeholder number and
    adds one, then loops in the (vanishing) case where the formatted candidate already exists.

    Mirrors generatePendingCrn() in crn.ts, including the `substr(crn, len(prefix) + 1)`
    offset — SQLite's substr is 1-indexed.
    """
    pad = 6
    while True:
        row = cur.execute(
            f"SELECT MAX(CAST(substr(crn, ?) AS INTEGER)) AS maxn FROM {TABLE_CLIENTS} WHERE crn LIKE ?",
            (len(PENDING_CRN_PREFIX) + 1, f"{PENDING_CRN_PREFIX}%"),
        ).fetchone()
        n = (row["maxn"] if row and row["maxn"] is not None else 0) + 1
        candidate = f"{PENDING_CRN_PREFIX}{n:0{pad}d}"
        exists = cur.execute(f"SELECT 1 FROM {TABLE_CLIENTS} WHERE crn = ?", (candidate,)).fetchone()
        if not exists:
            return candidate


def generate_next_crn(cur: sqlite3.Cursor, cfg: CrmConfig) -> str:
    """
    Reserve and return the next auto-generated CRN from the `crn_sequence` counter.

    Must run inside `BEGIN IMMEDIATE`. Reads and bumps the counter under the write lock, then
    loops past the rare case where the formatted candidate collides with a CRN that was typed
    in manually in the same shape.

    Only reachable when `cfg.crn.auto_generate` is True. Mirrors generateNextCrn() in crn.ts.
    """
    prefix, pad = cfg.crn.prefix, cfg.crn.pad
    while True:
        row = cur.execute(f"SELECT next_value FROM {TABLE_CRN_SEQUENCE} WHERE id = 1").fetchone()
        n = row["next_value"] if row else 1
        cur.execute(f"UPDATE {TABLE_CRN_SEQUENCE} SET next_value = ? WHERE id = 1", (n + 1,))
        candidate = f"{prefix}{n:0{pad}d}".upper()
        clash = cur.execute(f"SELECT 1 FROM {TABLE_CLIENTS} WHERE crn = ?", (candidate,)).fetchone()
        if not clash:
            return candidate
