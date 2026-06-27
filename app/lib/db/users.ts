import type { DuckDBConnection } from '@duckdb/node-api';
import path from 'path';
import fs from 'fs';
import { serializeWrite } from './writeQueue';
import { openDuckDbWithWalRecovery, registerCheckpointOnExit } from './shutdown';

const QUEUE_KEY = 'users';

// Store on `global` so the connection survives Next.js hot reloads in dev mode.
const g = global as typeof globalThis & {
  _usersConnectionPromise?: Promise<DuckDBConnection>;
};

// Returns the in-flight (or resolved) users connection only if one has already
// been started. Used by the auto-backup path so it can snapshot users.duckdb
// through the live connection without triggering its bootstrap.
export function getUsersConnectionIfOpen(): Promise<DuckDBConnection> | undefined {
  return g._usersConnectionPromise;
}

export async function getUsersConnection(): Promise<DuckDBConnection> {
  if (!g._usersConnectionPromise) {
    g._usersConnectionPromise = (async () => {
      const dbDir = process.env.DUCKDB_DIR;
      if (!dbDir) throw new Error('DUCKDB_DIR environment variable is not set');

      const resolvedDir = path.resolve(dbDir);
      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true });
      }
      const resolved = path.join(resolvedDir, 'users.duckdb');

      // Never auto-recreate — users holds account records. If unrecoverable,
      // fail loudly so we restore from backup instead of silently losing users.
      const conn = await openDuckDbWithWalRecovery(resolved, {
        logTag: 'users',
        allowRecreate: false,
      });

      // Bootstrap schema on first connection — all statements are idempotent (IF NOT EXISTS)
      await conn.run(`
        CREATE TABLE IF NOT EXISTS users (
          id             VARCHAR     PRIMARY KEY,
          email          VARCHAR     NOT NULL UNIQUE,
          first_name     VARCHAR     NOT NULL,
          last_name      VARCHAR     NOT NULL,
          title          VARCHAR     NOT NULL,
          department     VARCHAR     NOT NULL DEFAULT 'Default',
          team           VARCHAR     NOT NULL,
          office         VARCHAR     NOT NULL,
          role           VARCHAR     NOT NULL DEFAULT 'user',
          status         VARCHAR     NOT NULL DEFAULT 'pending',
          password_hash  VARCHAR     NOT NULL,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
          approved_at    TIMESTAMPTZ,
          approved_by_id VARCHAR
        )
      `);
      await conn.run(`CREATE INDEX IF NOT EXISTS idx_users_email  ON users (email)`);
      await conn.run(`CREATE INDEX IF NOT EXISTS idx_users_status ON users (status)`);

      // One-time migration: generalize legacy department value 'ISG' → 'Default'
      await conn.run(`UPDATE users SET department = 'Default' WHERE department = 'ISG'`);

      await conn.run(`
        CREATE TABLE IF NOT EXISTS team_members (
          id           VARCHAR     PRIMARY KEY,
          display_name VARCHAR     NOT NULL,
          first_name   VARCHAR     NOT NULL,
          last_name    VARCHAR     NOT NULL,
          team         VARCHAR     NOT NULL,
          office       VARCHAR     NOT NULL,
          status       VARCHAR     NOT NULL DEFAULT 'active',
          user_id      VARCHAR,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      await conn.run(`CREATE INDEX IF NOT EXISTS idx_tm_team   ON team_members (team)`);
      await conn.run(`CREATE INDEX IF NOT EXISTS idx_tm_status ON team_members (status)`);

      try { await conn.run(`CHECKPOINT`); } catch { /* best-effort */ }

      registerCheckpointOnExit('users', conn);

      return conn;
    })();
  }
  return g._usersConnectionPromise;
}

export async function queryUsers<T = Record<string, unknown>>(
  sql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[] = []
): Promise<T[]> {
  const conn = await getUsersConnection();
  const reader = await conn.runAndReadAll(sql, params.length ? params : undefined);
  return reader.getRowObjects() as T[];
}

export async function executeUsers(
  sql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[] = []
): Promise<void> {
  return serializeWrite(QUEUE_KEY, async () => {
    const conn = await getUsersConnection();
    await conn.run(sql, params.length ? params : undefined);
  });
}

// Use for mutations that return rows (UPDATE/DELETE/INSERT ... RETURNING).
// Goes through the users write queue.
export async function queryWriteUsers<T = Record<string, unknown>>(
  sql: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[] = []
): Promise<T[]> {
  return serializeWrite(QUEUE_KEY, async () => {
    const conn = await getUsersConnection();
    const reader = await conn.runAndReadAll(sql, params.length ? params : undefined);
    return reader.getRowObjects() as T[];
  });
}
