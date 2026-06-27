import { openSqlite, dbAll, dbRun, type DB } from './connection';

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
