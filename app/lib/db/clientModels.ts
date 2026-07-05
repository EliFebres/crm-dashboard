/**
 * Data layer for client-level model portfolios (`client_models`).
 *
 * A model belongs to an external client (keyed by CRN) and is shared across all of
 * that client's interactions — the canonical store the Portfolio modal and the
 * Settings → Client Management surface both read/write. Names are free-form per
 * client (NOT a shared managed registry), so there is no rename cascade; instead we
 * expose a single atomic bulk-replace that fits the "edit several, save together" UX.
 *
 * Invariant: at most one model per client carries `isMain`. replaceClientModels
 * enforces it (promotes the first when several — or none — are flagged).
 */
import { query, executeTransaction } from './index';
import { randomUUID } from 'crypto';
import type { ClientModel, PortfolioHolding } from '@/app/lib/types/engagements';
import { normalizeHoldingWeights } from '@/app/lib/utils/portfolioHoldings';

/** Carries an HTTP status so route handlers can translate it to a response. */
export class ClientModelError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ClientModelError';
  }
}

function parseHoldings(raw: unknown): PortfolioHolding[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PortfolioHolding[]) : [];
  } catch {
    return [];
  }
}

interface ClientModelRow {
  id: string;
  name: string;
  is_main: number;
  aum: number | null;
  holdings: string;
  sort_order: number;
}

function rowToModel(r: ClientModelRow): ClientModel {
  return {
    id: r.id,
    name: r.name,
    isMain: Boolean(r.is_main),
    aum: r.aum == null ? undefined : Number(r.aum),
    holdings: parseHoldings(r.holdings),
    sortOrder: Number(r.sort_order),
  };
}

/** List a client's models, ordered by sort_order then name. */
export async function listClientModels(crn: string): Promise<ClientModel[]> {
  const rows = await query<ClientModelRow>(
    `SELECT id, name, is_main, aum, holdings, sort_order
       FROM client_models
      WHERE crn = ?
      ORDER BY sort_order, name COLLATE NOCASE`,
    [crn]
  );
  return rows.map(rowToModel);
}

/** Coerce an incoming AUM value to a non-negative integer (dollars), or null. */
function normalizeAum(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Atomically replace a client's entire model set. Validates the client exists,
 * normalizes each model (name required, holding weights summed to 1, AUM coerced),
 * enforces the single-main invariant, then re-inserts with sort_order = index.
 * Returns the persisted models.
 */
export async function replaceClientModels(crn: string, input: unknown): Promise<ClientModel[]> {
  if (!Array.isArray(input)) {
    throw new ClientModelError(400, 'Expected an array of models.');
  }

  // Sanitize + normalize each model before touching the DB.
  const cleaned = input.map((raw) => {
    const m = (raw ?? {}) as Partial<ClientModel>;
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    if (!name) throw new ClientModelError(400, 'Every model needs a name.');
    return {
      id: typeof m.id === 'string' && m.id.trim() ? m.id : randomUUID(),
      name,
      isMain: Boolean(m.isMain),
      aum: normalizeAum(m.aum),
      holdings: normalizeHoldingWeights(Array.isArray(m.holdings) ? m.holdings : []),
    };
  });

  // Single-main invariant: keep the first flagged main; if none flagged and any
  // models exist, promote the first so the trends dashboard always has a target.
  let mainSeen = false;
  cleaned.forEach((m) => {
    if (m.isMain && !mainSeen) { mainSeen = true; }
    else { m.isMain = false; }
  });
  if (!mainSeen && cleaned.length > 0) cleaned[0].isMain = true;

  return executeTransaction<ClientModel[]>((tx) => {
    const client = tx.get<{ x: number }>(`SELECT 1 AS x FROM clients WHERE crn = ?`, [crn]);
    if (!client) throw new ClientModelError(404, 'Client not found.');

    tx.run(`DELETE FROM client_models WHERE crn = ?`, [crn]);
    cleaned.forEach((m, i) => {
      tx.run(
        `INSERT INTO client_models (id, crn, name, is_main, aum, holdings, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.id, crn, m.name, m.isMain ? 1 : 0, m.aum, JSON.stringify(m.holdings), i]
      );
    });

    return cleaned.map((m, i) => ({
      id: m.id,
      name: m.name,
      isMain: m.isMain,
      aum: m.aum == null ? undefined : m.aum,
      holdings: m.holdings,
      sortOrder: i,
    }));
  });
}
