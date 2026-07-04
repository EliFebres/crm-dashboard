/**
 * CRN (Client Reference Number) configuration + helpers.
 *
 * The CRN is the canonical identifier for an external client. How the value is
 * sourced is configured in `app.config.ts` (committed, non-secret) under `crn`:
 *   - autoGenerate=false (default) — users type an existing external CRN,
 *     validated for format + uniqueness.
 *   - autoGenerate=true            — the system generates the next CRN when a new
 *     client is registered, formatted as `${prefix}${zero-padded counter}`.
 */
import type { Tx } from '../db';
import { appConfig } from '../../../app.config';

export interface CrnConfig {
  autoGenerate: boolean;
  prefix: string;
  pad: number;
  /** Allowed shape for a manually-entered CRN (already normalized to uppercase). */
  pattern: RegExp;
}

export function crnConfig(): CrnConfig {
  const { autoGenerate, prefix, pad } = appConfig.crn;
  return {
    autoGenerate,
    prefix: prefix ?? 'CRN-',
    pad: Number.isFinite(pad) && pad > 0 ? pad : 6,
    // 3–32 chars: uppercase alphanumerics and dashes, must start alphanumeric.
    pattern: /^[A-Z0-9][A-Z0-9-]{2,31}$/,
  };
}

/** Trim and uppercase so CRNs compare case-insensitively against the PK. */
export function normalizeCrn(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Placeholder CRN prefix. A client can be registered before its real CRN is known;
 * the system assigns it a `PENDING-000001`-style CRN and flags `crn_pending` so the
 * UI can highlight it and prompt for the real value later.
 */
export const PENDING_CRN_PREFIX = 'PENDING-';

/** True when `crn` is a system-generated placeholder awaiting a real value. */
export function isPendingCrn(crn: string): boolean {
  return crn.toUpperCase().startsWith(PENDING_CRN_PREFIX);
}

/**
 * Reserve and return the next placeholder CRN (`PENDING-000001`, …). Like
 * generateNextCrn, MUST run inside an executeTransaction callback so the max-scan
 * and insert are atomic. Loops past the rare case where the candidate already exists.
 */
export function generatePendingCrn(tx: Tx): string {
  const pad = 6;
  for (;;) {
    const row = tx.get<{ maxn: number | null }>(
      `SELECT MAX(CAST(substr(crn, ?) AS INTEGER)) AS maxn FROM clients WHERE crn LIKE ?`,
      [PENDING_CRN_PREFIX.length + 1, `${PENDING_CRN_PREFIX}%`]
    );
    const n = (row?.maxn ?? 0) + 1;
    const candidate = `${PENDING_CRN_PREFIX}${String(n).padStart(pad, '0')}`;
    if (!tx.get(`SELECT 1 FROM clients WHERE crn = ?`, [candidate])) return candidate;
  }
}

/** True when `crn` (already normalized) is a syntactically valid CRN. */
export function isValidCrn(crn: string): boolean {
  return crnConfig().pattern.test(crn);
}

/**
 * Reserve and return the next auto-generated CRN. MUST be called inside an
 * executeTransaction callback — better-sqlite3 is synchronous and serialized, so
 * the read-increment within the transaction is atomic (no counter race). Loops
 * past the rare case where the formatted candidate collides with a CRN that was
 * entered manually in the same shape.
 */
export function generateNextCrn(tx: Tx): string {
  const { prefix, pad } = crnConfig();
  for (;;) {
    const row = tx.get<{ next_value: number }>(`SELECT next_value FROM crn_sequence WHERE id = 1`);
    const n = row?.next_value ?? 1;
    tx.run(`UPDATE crn_sequence SET next_value = ? WHERE id = 1`, [n + 1]);
    const candidate = `${prefix}${String(n).padStart(pad, '0')}`.toUpperCase();
    const clash = tx.get(`SELECT 1 FROM clients WHERE crn = ?`, [candidate]);
    if (!clash) return candidate;
  }
}
