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
