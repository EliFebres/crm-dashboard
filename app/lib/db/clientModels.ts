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
 *
 * Attribution: a model records the interaction that logged it (`logged_engagement_id`).
 * The export reads that interaction's Project ID through the link. A model is
 * considered "logged" when it is created, or when its content (name, AUM, holdings)
 * changes — flipping `isMain` or reordering is not a re-log.
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
  logged_engagement_id: number | null;
  is_main: number;
  aum: number | null;
  holdings: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToModel(r: ClientModelRow): ClientModel {
  return {
    id: r.id,
    name: r.name,
    isMain: Boolean(r.is_main),
    aum: r.aum == null ? undefined : Number(r.aum),
    holdings: parseHoldings(r.holdings),
    sortOrder: Number(r.sort_order),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** List a client's models, ordered by sort_order then name. */
export async function listClientModels(crn: string): Promise<ClientModel[]> {
  const rows = await query<ClientModelRow>(
    `SELECT id, name, logged_engagement_id, is_main, aum, holdings, sort_order, created_at, updated_at
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

/** What a save persisted, plus which models it counted as freshly logged. */
export interface ReplaceClientModelsResult {
  models: ClientModel[];
  /**
   * Models created or content-changed by this save. When `loggedEngagementId` is
   * given they have already been attributed to it; when it is null (a brand-new
   * interaction, whose id does not exist yet) the caller attributes them afterwards
   * via `attributeClientModels`.
   */
  loggedModelIds: string[];
}

/**
 * Atomically replace a client's entire model set. Validates the client exists,
 * normalizes each model (name required, holding weights summed to 1, AUM coerced),
 * enforces the single-main invariant, then re-inserts with sort_order = index.
 *
 * `loggedEngagementId` is the interaction the save was made from, or null when there
 * is none (Settings → Client Management, or an unsaved new interaction). Models that
 * are created or content-changed are attributed to it; untouched models keep whatever
 * interaction logged them.
 */
export async function replaceClientModels(
  crn: string,
  input: unknown,
  loggedEngagementId: number | null = null
): Promise<ReplaceClientModelsResult> {
  if (!Array.isArray(input)) {
    throw new ClientModelError(400, 'Expected an array of models.');
  }

  // Sanitize + normalize each model before touching the DB. `loggedAt` is an
  // optional seed-only override for the log timestamp; the UI never sends it.
  const cleaned = input.map((raw) => {
    const m = (raw ?? {}) as Partial<ClientModel> & { loggedAt?: string };
    const name = typeof m.name === 'string' ? m.name.trim() : '';
    if (!name) throw new ClientModelError(400, 'Every model needs a name.');
    return {
      id: typeof m.id === 'string' && m.id.trim() ? m.id : randomUUID(),
      name,
      isMain: Boolean(m.isMain),
      aum: normalizeAum(m.aum),
      holdings: normalizeHoldingWeights(Array.isArray(m.holdings) ? m.holdings : []),
      loggedAt: typeof m.loggedAt === 'string' && m.loggedAt.trim() ? m.loggedAt.trim() : null,
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

  return executeTransaction<ReplaceClientModelsResult>((tx) => {
    const client = tx.get<{ x: number }>(`SELECT 1 AS x FROM clients WHERE crn = ?`, [crn]);
    if (!client) throw new ClientModelError(404, 'Client not found.');

    // The attributing interaction must belong to this client, or the export would
    // report a Project ID from someone else's project.
    if (loggedEngagementId != null) {
      const owner = tx.get<{ client_crn: string | null }>(
        `SELECT client_crn FROM engagements WHERE id = ?`,
        [loggedEngagementId]
      );
      if (!owner) throw new ClientModelError(404, 'Interaction not found.');
      if (owner.client_crn !== crn) {
        throw new ClientModelError(400, 'Interaction belongs to a different client.');
      }
    }

    const loggedModelIds: string[] = [];

    // Snapshot existing rows so we can preserve created_at and only bump updated_at
    // when a model's content actually changed (so "logged" dates stay meaningful).
    const existing = new Map(
      tx.all<ClientModelRow>(
        `SELECT id, name, logged_engagement_id, is_main, aum, holdings, sort_order, created_at, updated_at
           FROM client_models WHERE crn = ?`,
        [crn]
      ).map((r) => [r.id, r])
    );

    // Drop rows the caller no longer includes.
    const keepIds = cleaned.map((m) => m.id);
    if (keepIds.length === 0) {
      tx.run(`DELETE FROM client_models WHERE crn = ?`, [crn]);
    } else {
      const placeholders = keepIds.map(() => '?').join(', ');
      tx.run(
        `DELETE FROM client_models WHERE crn = ? AND id NOT IN (${placeholders})`,
        [crn, ...keepIds]
      );
    }

    cleaned.forEach((m, i) => {
      const holdingsJson = JSON.stringify(m.holdings);
      const prev = existing.get(m.id);
      if (!prev) {
        // New model: created_at/updated_at land on loggedAt (seed) or now.
        loggedModelIds.push(m.id);
        tx.run(
          `INSERT INTO client_models
             (id, crn, name, logged_engagement_id, is_main, aum, holdings, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
          [m.id, crn, m.name, loggedEngagementId, m.isMain ? 1 : 0, m.aum, holdingsJson, i, m.loggedAt, m.loggedAt]
        );
      } else {
        // A re-log is a content change: name, AUM or holdings. Flipping isMain or
        // reordering is bookkeeping, not a new logging of the model, so it neither
        // re-attributes nor (for sort_order) bumps updated_at.
        const contentChanged =
          prev.name !== m.name ||
          (prev.aum == null ? null : Number(prev.aum)) !== (m.aum == null ? null : m.aum) ||
          prev.holdings !== holdingsJson;
        const changed = contentChanged || Boolean(prev.is_main) !== m.isMain;
        if (contentChanged) loggedModelIds.push(m.id);
        // Re-attribute only a re-logged model, and only when we know the interaction.
        // Otherwise keep whichever interaction logged it originally.
        const attributed =
          contentChanged && loggedEngagementId != null ? loggedEngagementId : prev.logged_engagement_id;
        // Preserve created_at; advance updated_at only on a real content change
        // (a seed loggedAt override still wins when provided).
        tx.run(
          `UPDATE client_models
              SET name = ?, logged_engagement_id = ?, is_main = ?, aum = ?, holdings = ?, sort_order = ?,
                  updated_at = COALESCE(?, ${changed ? `datetime('now')` : 'updated_at'})
            WHERE id = ?`,
          [m.name, attributed, m.isMain ? 1 : 0, m.aum, holdingsJson, i, m.loggedAt, m.id]
        );
      }
    });

    // Re-select so the response carries accurate persisted timestamps.
    const models = tx.all<ClientModelRow>(
      `SELECT id, name, logged_engagement_id, is_main, aum, holdings, sort_order, created_at, updated_at
         FROM client_models
        WHERE crn = ?
        ORDER BY sort_order, name COLLATE NOCASE`,
      [crn]
    ).map(rowToModel);
    return { models, loggedModelIds };
  });
}

/**
 * Attribute already-saved models to the interaction that logged them.
 *
 * Needed only for the create path: models can be logged from the new-interaction form
 * before that interaction exists, so they are saved unattributed and claimed here once
 * it has an id. Returns how many rows were updated.
 */
export async function attributeClientModels(
  crn: string,
  engagementId: number,
  modelIds: string[]
): Promise<number> {
  if (modelIds.length === 0) return 0;

  return executeTransaction<number>((tx) => {
    const owner = tx.get<{ client_crn: string | null }>(
      `SELECT client_crn FROM engagements WHERE id = ?`,
      [engagementId]
    );
    if (!owner) throw new ClientModelError(404, 'Interaction not found.');
    if (owner.client_crn !== crn) {
      throw new ClientModelError(400, 'Interaction belongs to a different client.');
    }

    // Scoped by crn as well as id, so a caller cannot attribute another client's models.
    const placeholders = modelIds.map(() => '?').join(', ');
    const res = tx.run(
      `UPDATE client_models SET logged_engagement_id = ?
        WHERE crn = ? AND id IN (${placeholders})`,
      [engagementId, crn, ...modelIds]
    );
    return Number(res.changes ?? 0);
  });
}
