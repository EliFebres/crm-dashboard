import { openSqlite, dbAll, dbRun, columnExists, type DB } from './connection';
import { randomUUID } from 'crypto';

// Cached on `global` so the connection survives Next.js hot reloads in dev mode.
const g = global as typeof globalThis & {
  _usersDb?: DB;
};

function bootstrap(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id             TEXT PRIMARY KEY,
      email          TEXT NOT NULL UNIQUE,
      first_name     TEXT NOT NULL,
      last_name      TEXT NOT NULL,
      title          TEXT NOT NULL,
      department     TEXT NOT NULL DEFAULT 'Default',
      team           TEXT NOT NULL,
      office         TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'user',
      status         TEXT NOT NULL DEFAULT 'pending',
      password_hash  TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      approved_at    TEXT,
      approved_by_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_users_email  ON users (email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
  `);

  // One-time migration: generalize legacy department value 'ISG' → 'Default'
  db.exec(`UPDATE users SET department = 'Default' WHERE department = 'ISG'`);

  // Marks accounts created by the mock seed script (`npm run seed:mock`). Set ONLY
  // by that script — never from a signup request — so the first-user-admin rule can
  // ignore seeded demo accounts without a signup payload being able to fake it.
  // Defaults 0, so real/existing databases are unaffected.
  if (!columnExists(db, 'users', 'is_seed')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS team_members (
      id           TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      first_name   TEXT NOT NULL,
      last_name    TEXT NOT NULL,
      team         TEXT NOT NULL,
      office       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      user_id      TEXT,
      created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_tm_team   ON team_members (team);
    CREATE INDEX IF NOT EXISTS idx_tm_status ON team_members (status);
  `);

  // Teams and offices were once hardcoded constants duplicated across the app.
  // They now live here so admins can rename/add/remove them from Settings.
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS offices (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: teams/offices are admin-orderable, so each carries a sort_order.
  // The ALTER runs once (guarded by columnExists); inside that guard we backfill
  // existing rows by their current alphabetical order so they don't all sit at 0.
  for (const table of ['teams', 'offices'] as const) {
    if (!columnExists(db, table, 'sort_order')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
      const rows = db.prepare(`SELECT id FROM ${table} ORDER BY name COLLATE NOCASE`).all() as Array<{ id: string }>;
      const setOrder = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
      rows.forEach((r, i) => setOrder.run(i, r.id));
    }
  }

  seedOrgLists(db);
}

/**
 * Idempotent seed/backfill for the teams/offices lists.
 *
 *  1. Backfill any distinct team/office value already referenced by users or
 *     team_members, so an existing database keeps every value it relies on as a
 *     valid option.
 *  2. If a list is still empty (a brand-new database with no users yet), seed
 *     the single default the first-run signup form should offer.
 */
function seedOrgLists(db: DB): void {
  db.exec(`
    INSERT OR IGNORE INTO teams (id, name)
    SELECT lower(hex(randomblob(16))), team FROM (
      SELECT team FROM users
      UNION
      SELECT team FROM team_members
    ) WHERE team IS NOT NULL AND trim(team) <> '';

    INSERT OR IGNORE INTO offices (id, name)
    SELECT lower(hex(randomblob(16))), office FROM (
      SELECT office FROM users
      UNION
      SELECT office FROM team_members
    ) WHERE office IS NOT NULL AND trim(office) <> '';
  `);

  const teamCount = (db.prepare(`SELECT COUNT(*) AS c FROM teams`).get() as { c: number }).c;
  if (teamCount === 0) {
    db.prepare(`INSERT INTO teams (id, name) VALUES (?, 'Default Team')`).run(randomUUID());
  }
  const officeCount = (db.prepare(`SELECT COUNT(*) AS c FROM offices`).get() as { c: number }).c;
  if (officeCount === 0) {
    db.prepare(`INSERT INTO offices (id, name) VALUES (?, 'Office A')`).run(randomUUID());
  }
}

function getDb(): DB {
  if (!g._usersDb) {
    // Never auto-recreate — users holds account records. If unrecoverable, fail
    // loudly so we restore from backup instead of silently losing users.
    g._usersDb = openSqlite('users.sqlite', 'users', bootstrap, { allowRecreate: false });
  }
  return g._usersDb;
}

export async function queryUsers<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return dbAll<T>(getDb(), sql, params);
}

export async function executeUsers(sql: string, params: unknown[] = []): Promise<void> {
  dbRun(getDb(), sql, params);
}

// Use for mutations that return rows (UPDATE/DELETE/INSERT ... RETURNING).
export async function queryWriteUsers<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return dbAll<T>(getDb(), sql, params);
}

/** Helpers passed to a {@link usersTransaction} callback for synchronous reads/writes. */
export interface UsersTx {
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  run(sql: string, params?: unknown[]): void;
}

/**
 * Run `fn` inside a single better-sqlite3 transaction against the users DB.
 * Use for multi-statement mutations that must be atomic — e.g. renaming a team
 * and cascading the new name into `users` and `team_members`.
 */
export async function usersTransaction<T>(fn: (tx: UsersTx) => T): Promise<T> {
  const db = getDb();
  const tx: UsersTx = {
    get: (sql, params = []) => dbAll(db, sql, params)[0] as never,
    all: (sql, params = []) => dbAll(db, sql, params) as never,
    run: (sql, params = []) => { dbRun(db, sql, params); },
  };
  return db.transaction(() => fn(tx))();
}
