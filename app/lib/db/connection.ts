/**
 * Shared SQLite (better-sqlite3) connection helpers.
 *
 * Every database module (engagements / users / activity) opens its file through
 * `openSqlite` and routes reads/writes through the thin `dbAll` / `dbRun`
 * helpers here. better-sqlite3 is synchronous and serializes statements
 * internally, so there is no need for the per-DB JS write queue the old DuckDB
 * layer required — concurrent requests can't interleave a single statement.
 *
 * The wrapper functions exported by the per-DB modules keep their async
 * (`Promise`-returning) signatures so the ~12 API routes that `await query(...)`
 * need no changes.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export type DB = Database.Database;

// Resolve the data directory. Prefers the new SQLITE_DIR but falls back to the
// legacy DUCKDB_DIR so an existing .env keeps working until it's updated.
export function getDbDir(): string | undefined {
  return process.env.SQLITE_DIR || process.env.DUCKDB_DIR || undefined;
}

// True when a real database is configured. When false, the aggregation layers
// return mock/empty data (dev-without-db mode).
export function hasDb(): boolean {
  return Boolean(getDbDir());
}

// better-sqlite3 rejects JS booleans and `undefined` as bound values. Map them
// to the SQLite-native equivalents (1/0 and NULL). DuckDB accepted these
// directly, so this preserves callsite behavior.
function normParams(params: unknown[]): unknown[] {
  return params.map((v) =>
    typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v,
  );
}

export function dbAll<T = Record<string, unknown>>(
  db: DB,
  sql: string,
  params: unknown[] = [],
): T[] {
  const stmt = db.prepare(sql);
  return (params.length ? stmt.all(normParams(params)) : stmt.all()) as T[];
}

export function dbGet<T = Record<string, unknown>>(
  db: DB,
  sql: string,
  params: unknown[] = [],
): T | undefined {
  const stmt = db.prepare(sql);
  return (params.length ? stmt.get(normParams(params)) : stmt.get()) as T | undefined;
}

export function dbRun(
  db: DB,
  sql: string,
  params: unknown[] = [],
): Database.RunResult {
  const stmt = db.prepare(sql);
  return params.length ? stmt.run(normParams(params)) : stmt.run();
}

// Returns true if `table` has a column named `column` — the SQLite replacement
// for the old information_schema.columns existence checks used by migrations.
export function columnExists(db: DB, table: string, column: string): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

/**
 * Open (or create) a SQLite file with WAL mode and sane durability pragmas,
 * run the caller's idempotent bootstrap, and register a checkpoint-on-exit hook.
 *
 * `allowRecreate` mirrors the old DuckDB behavior: for telemetry DBs where
 * losing the file is acceptable, a corrupt file is unlinked and recreated; for
 * DBs holding real user data it stays false so we fail loudly and restore from
 * backup instead of silently destroying data.
 */
export function openSqlite(
  fileName: string,
  logTag: string,
  bootstrap: (db: DB) => void,
  opts: { allowRecreate?: boolean } = {},
): DB {
  const dir = getDbDir();
  if (!dir) throw new Error('SQLITE_DIR environment variable is not set');

  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) fs.mkdirSync(resolvedDir, { recursive: true });
  const file = path.join(resolvedDir, fileName);

  let db: DB;
  try {
    db = applyPragmas(new Database(file));
    bootstrap(db);
  } catch (err) {
    if (!opts.allowRecreate) {
      console.error(
        `[${logTag}] failed to open ${file}. Auto-recreate is disabled for this ` +
          `database to prevent data loss. Stop the server and run 'npm run db:restore' ` +
          `to restore the most recent backup.`,
      );
      throw err;
    }
    console.warn(`[${logTag}] open failed; recreating ${file}:`, err);
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* ignore */ }
    try { if (fs.existsSync(`${file}-wal`)) fs.unlinkSync(`${file}-wal`); } catch { /* ignore */ }
    try { if (fs.existsSync(`${file}-shm`)) fs.unlinkSync(`${file}-shm`); } catch { /* ignore */ }
    db = applyPragmas(new Database(file));
    bootstrap(db);
  }

  registerCheckpointOnExit(logTag, db);
  return db;
}

function applyPragmas(db: DB): DB {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

// ---------------------------------------------------------------------------
// Graceful shutdown: checkpoint the WAL into the main file and close cleanly on
// Ctrl+C / SIGTERM / beforeExit. Stored on `global` so HMR doesn't stack
// handlers or lose the registry between reloads.
// ---------------------------------------------------------------------------
const g = global as typeof globalThis & {
  _dbShutdownHooks?: Map<string, DB>;
  _dbShutdownInstalled?: boolean;
};

export function registerCheckpointOnExit(name: string, db: DB): void {
  if (!g._dbShutdownHooks) g._dbShutdownHooks = new Map();
  g._dbShutdownHooks.set(name, db);
  installProcessHandlersOnce();
}

function checkpointAll(): void {
  const hooks = g._dbShutdownHooks;
  if (!hooks) return;
  for (const [name, db] of hooks.entries()) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
    } catch (err) {
      console.error(`[${name}] checkpoint/close on shutdown failed:`, err);
    }
  }
}

function installProcessHandlersOnce(): void {
  if (g._dbShutdownInstalled) return;
  g._dbShutdownInstalled = true;

  const onSignal = () => {
    checkpointAll();
    process.exit(0);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  // beforeExit fires when the loop empties — flush but don't force-exit.
  process.once('beforeExit', () => { checkpointAll(); });
}
