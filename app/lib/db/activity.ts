import { openSqlite, dbAll, dbRun, columnExists, type DB } from './connection';

const g = global as typeof globalThis & {
  _activityDb?: DB;
};

function bootstrap(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id           TEXT PRIMARY KEY,
      timestamp    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id      TEXT,
      user_email   TEXT,
      user_name    TEXT,
      user_office  TEXT,
      action       TEXT NOT NULL,
      entity_type  TEXT,
      entity_id    TEXT,
      details      TEXT,
      ip           TEXT,
      user_agent   TEXT
    );
  `);

  // Additive migration, gated on a column-existence check.
  if (!columnExists(db, 'activity_logs', 'user_office')) {
    db.exec(`ALTER TABLE activity_logs ADD COLUMN user_office TEXT`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_activity_ts     ON activity_logs (timestamp);
    CREATE INDEX IF NOT EXISTS idx_activity_user   ON activity_logs (user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_logs (action);
  `);

  // Retention: drop activity_logs older than 30 days on connection init.
  try {
    db.exec(`DELETE FROM activity_logs WHERE datetime(timestamp) < datetime('now', '-30 days')`);
  } catch (err) {
    console.error('[activity] retention cleanup failed at init:', err);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id    TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      user_name  TEXT NOT NULL,
      last_seen  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON user_presence (last_seen);
  `);
}

function getDb(): DB {
  if (!g._activityDb) {
    // Activity is telemetry with 30-day retention — allow recreate as a last
    // resort if the file is unrecoverable.
    g._activityDb = openSqlite('activity.sqlite', 'activity', bootstrap, { allowRecreate: true });
  }
  return g._activityDb;
}

export async function queryActivity<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return dbAll<T>(getDb(), sql, params);
}

export async function executeActivity(sql: string, params: unknown[] = []): Promise<void> {
  dbRun(getDb(), sql, params);
}

// Use for mutations that return rows (UPDATE/DELETE/INSERT ... RETURNING).
export async function queryWriteActivity<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return dbAll<T>(getDb(), sql, params);
}
