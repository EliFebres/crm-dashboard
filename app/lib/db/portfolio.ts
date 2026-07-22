/**
 * Data layer for `portfolio.sqlite` — the analytical store behind Portfolio Trends.
 *
 * This is a denormalized projection of `client_models` (engagements.sqlite), not a
 * second source of truth. Every column the dashboard filters on — client department,
 * logging office, AUM — is copied onto the model row, so questions like "the models
 * behind Brokerage interactions over $1B AUM logged out of a given office" resolve
 * against this file alone: one connection, no ATTACH, no cross-database join.
 *
 * That denormalization is the deliberate trade for keeping the store in its own file.
 * SQLite cannot enforce a foreign key across files, so `crn` and `source_engagement_id`
 * are plain columns; `client_name` is a copy that goes stale on rename until the next
 * sync. scripts/sync-portfolio.ts is the sole writer and the reconciliation point.
 *
 * Holdings are relational here even though `client_models` stores them as a JSON blob.
 * The access patterns are opposites: client_models only ever reads or writes the whole
 * blob, while this store queries *into* holdings (GROUP BY asset_class, SUM(weight),
 * WHERE identifier = ?) — which JSON cannot index.
 *
 * State is current-only: one row per model, upserted. There is no history, so `logged_at`
 * means "when this row was last logged", never a point-in-time snapshot.
 */
import { openSqlite, dbAll, dbRun, type DB } from './connection';
import type { PortfolioHolding } from '@/app/lib/types/engagements';
import { normalizeHoldingWeights } from '@/app/lib/utils/portfolioHoldings';

// Cached on `global` so the connection survives Next.js hot reloads in dev mode.
const g = global as typeof globalThis & {
  _portfolioDb?: DB;
};

function bootstrap(db: DB): void {
  // All statements are idempotent so bootstrap is safe to run on every open.
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_models (
      id                   TEXT PRIMARY KEY,
      crn                  TEXT NOT NULL,
      client_name          TEXT NOT NULL,
      model_name           TEXT NOT NULL,
      is_main              INTEGER NOT NULL DEFAULT 0,
      aum                  INTEGER,
      client_dept          TEXT,
      logged_team          TEXT,
      logged_office        TEXT,
      logged_at            TEXT,
      source_engagement_id INTEGER,
      synced_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Serves the dashboard's headline filter directly: both equality predicates lead,
  // the aum range scan trails.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_pm_dept_office_aum ON portfolio_models (client_dept, logged_office, aum);
    CREATE INDEX IF NOT EXISTS idx_pm_crn             ON portfolio_models (crn);
    CREATE INDEX IF NOT EXISTS idx_pm_logged_at       ON portfolio_models (logged_at);
  `);

  // Same-file FK, so ON DELETE CASCADE actually fires (foreign_keys = ON is set by
  // applyPragmas in connection.ts). Replacing a model's holdings is delete + reinsert.
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id         TEXT NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
      identifier       TEXT NOT NULL,
      constituent_type TEXT NOT NULL,
      asset_class      TEXT NOT NULL,
      weight           REAL NOT NULL,
      sort_order       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ph_model       ON portfolio_holdings (model_id);
    CREATE INDEX IF NOT EXISTS idx_ph_asset_class ON portfolio_holdings (asset_class);
    CREATE INDEX IF NOT EXISTS idx_ph_identifier  ON portfolio_holdings (identifier);
  `);
}

function getDb(): DB {
  if (!g._portfolioDb) {
    // Never auto-recreate — this holds financial data. If unrecoverable, fail loudly
    // so we restore from backup rather than silently starting from an empty file.
    g._portfolioDb = openSqlite('portfolio.sqlite', 'portfolio', bootstrap, { allowRecreate: false });
  }
  return g._portfolioDb;
}

export async function queryPortfolio<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return dbAll<T>(getDb(), sql, params);
}

export async function executePortfolio(sql: string, params: unknown[] = []): Promise<void> {
  dbRun(getDb(), sql, params);
}

/** Helpers passed to a {@link portfolioTransaction} callback for synchronous reads/writes. */
export interface PortfolioTx {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): void;
}

/**
 * Run `fn` inside a single better-sqlite3 transaction against the portfolio DB.
 * Use for multi-statement mutations that must be atomic — e.g. upserting a model
 * and replacing its holdings.
 */
export async function portfolioTransaction<T>(fn: (tx: PortfolioTx) => T): Promise<T> {
  const db = getDb();
  const tx: PortfolioTx = {
    get: (sql, params = []) => dbAll(db, sql, params)[0] as never,
    all: (sql, params = []) => dbAll(db, sql, params) as never,
    run: (sql, params = []) => { dbRun(db, sql, params); },
  };
  return db.transaction(() => fn(tx))();
}

/** One model as the sync script hands it over. `id` reuses client_models.id. */
export interface PortfolioModelInput {
  id: string;
  crn: string;
  clientName: string;
  modelName: string;
  isMain: boolean;
  aum: number | null;
  clientDept: string | null;
  loggedTeam: string | null;
  loggedOffice: string | null;
  loggedAt: string | null;
  sourceEngagementId: number | null;
  holdings: PortfolioHolding[];
}

const UPSERT_MODEL_SQL = `
  INSERT INTO portfolio_models
    (id, crn, client_name, model_name, is_main, aum, client_dept,
     logged_team, logged_office, logged_at, source_engagement_id, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(id) DO UPDATE SET
    crn                  = excluded.crn,
    client_name          = excluded.client_name,
    model_name           = excluded.model_name,
    is_main              = excluded.is_main,
    aum                  = excluded.aum,
    client_dept          = excluded.client_dept,
    logged_team          = excluded.logged_team,
    logged_office        = excluded.logged_office,
    logged_at            = excluded.logged_at,
    source_engagement_id = excluded.source_engagement_id,
    synced_at            = CURRENT_TIMESTAMP
`;

/** Upsert the model row and fully replace its holdings, within an open transaction. */
function writeModel(tx: PortfolioTx, m: PortfolioModelInput): void {
  tx.run(UPSERT_MODEL_SQL, [
    m.id, m.crn, m.clientName, m.modelName, m.isMain ? 1 : 0, m.aum,
    m.clientDept, m.loggedTeam, m.loggedOffice, m.loggedAt, m.sourceEngagementId,
  ]);

  // Holdings carry no stable identity of their own, so replace wholesale rather than
  // diff. Normalizing here (not just at the callsite) keeps weights summing to 1 no
  // matter which writer produced them.
  tx.run(`DELETE FROM portfolio_holdings WHERE model_id = ?`, [m.id]);
  normalizeHoldingWeights(m.holdings).forEach((h, i) => {
    tx.run(
      `INSERT INTO portfolio_holdings
         (model_id, identifier, constituent_type, asset_class, weight, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [m.id, h.identifier, h.constituentType, h.assetClass, h.weight, i]
    );
  });
}

/** Upsert one model and fully replace its holdings. Atomic. */
export async function upsertPortfolioModel(model: PortfolioModelInput): Promise<void> {
  await portfolioTransaction((tx) => writeModel(tx, model));
}

/**
 * Upsert a client's models, then drop any of that client's models the caller no longer
 * includes — mirroring replaceClientModels' delete-missing semantics, so a model deleted
 * upstream doesn't linger here and pollute AUM rollups. Holdings go with it via cascade.
 */
export async function replacePortfolioModelsForCrn(
  crn: string,
  models: PortfolioModelInput[],
): Promise<void> {
  await portfolioTransaction((tx) => {
    models.forEach((m) => writeModel(tx, m));

    const keepIds = models.map((m) => m.id);
    if (keepIds.length === 0) {
      tx.run(`DELETE FROM portfolio_models WHERE crn = ?`, [crn]);
    } else {
      const placeholders = keepIds.map(() => '?').join(', ');
      tx.run(
        `DELETE FROM portfolio_models WHERE crn = ? AND id NOT IN (${placeholders})`,
        [crn, ...keepIds]
      );
    }
  });
}
