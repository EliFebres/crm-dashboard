import Database from 'better-sqlite3';
import { openSqlite, dbAll, dbGet, dbRun, columnExists, type DB } from './connection';
import { maybeRunDailyAutoBackup } from './autoBackup';

// Re-export the db-presence helper so routes can gate mock-vs-real data via the
// barrel without importing the connection module directly.
export { hasDb, getDbDir } from './connection';

// Cached on `global` so the connection survives Next.js hot reloads in dev mode.
// Module-level variables get reset on each reload, which would re-open the file
// and re-run bootstrap on every change.
const g = global as typeof globalThis & {
  _engagementsDb?: DB;
};

function bootstrap(db: DB): void {
  // All statements are idempotent so bootstrap is safe to run on every open.
  db.exec(`
    CREATE TABLE IF NOT EXISTS engagements (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      external_client      TEXT,
      internal_client_name TEXT    NOT NULL,
      internal_client_dept TEXT    NOT NULL,
      intake_type          TEXT    NOT NULL,
      ad_hoc_channel       TEXT,
      type                 TEXT    NOT NULL,
      team_members         TEXT    NOT NULL DEFAULT '[]',
      department           TEXT    NOT NULL,
      date_started         TEXT    NOT NULL,
      date_finished        TEXT,
      status               TEXT    NOT NULL,
      portfolio_logged     INTEGER NOT NULL DEFAULT 0,
      portfolio            TEXT,
      nna                  INTEGER,
      notes                TEXT,
      tickers_mentioned    TEXT,
      linked_from_id       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_date_started     ON engagements (date_started);
    CREATE INDEX IF NOT EXISTS idx_status           ON engagements (status);
    CREATE INDEX IF NOT EXISTS idx_department       ON engagements (department);
    CREATE INDEX IF NOT EXISTS idx_date_finished    ON engagements (date_finished);
    CREATE INDEX IF NOT EXISTS idx_intake_type      ON engagements (intake_type);
    CREATE INDEX IF NOT EXISTS idx_started_status   ON engagements (date_started, status);
    CREATE INDEX IF NOT EXISTS idx_dept_started     ON engagements (internal_client_dept, date_started);
    CREATE INDEX IF NOT EXISTS idx_date_fin_started ON engagements (date_finished, date_started);
  `);

  // Canonical client registry. The external client is identified by a unique CRN
  // (Client Reference Number); the canonical name lives ONLY here and is resolved
  // by JOIN on read, so names can never drift across interactions. CRNs are stored
  // trimmed + uppercased, so the case-sensitive PK behaves case-insensitively.
  // Global (not team-scoped): an external company is one identity and its CRN must
  // be unique system-wide. Engagement-level `team` isolation still scopes lists/KPIs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      crn             TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_id   TEXT,
      created_by_name TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_name_nocase ON clients (name COLLATE NOCASE);
  `);

  // Monotonic counter backing CRN auto-generation (appConfig.crn.autoGenerate). The
  // single-row CHECK keeps it a singleton; INSERT OR IGNORE seeds it once.
  db.exec(`
    CREATE TABLE IF NOT EXISTS crn_sequence (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      next_value INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO crn_sequence (id, next_value) VALUES (1, 1);
  `);

  // Optimistic locking: version counter incremented on every update so concurrent
  // edits detect conflicts instead of silently overwriting each other.
  if (!columnExists(db, 'engagements', 'version')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN version INTEGER DEFAULT 1`);
  }

  // Engagement notes — append-only log with author attribution.
  db.exec(`
    CREATE TABLE IF NOT EXISTS engagement_notes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      engagement_id INTEGER NOT NULL,
      note_text     TEXT    NOT NULL,
      author_name   TEXT    NOT NULL,
      author_id     TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_engagement_notes_engagement_id ON engagement_notes (engagement_id);
  `);

  // One-time migration: copy legacy free-text notes into the new log table.
  // Guard: only migrate engagements with no entries yet, so re-runs are safe.
  db.exec(`
    INSERT INTO engagement_notes (engagement_id, note_text, author_name, author_id, created_at)
    SELECT id, notes, 'Imported Note', 'system', CURRENT_TIMESTAMP
    FROM engagements
    WHERE notes IS NOT NULL
      AND notes != ''
      AND id NOT IN (SELECT DISTINCT engagement_id FROM engagement_notes)
  `);

  // One-time value renames
  db.exec(`UPDATE engagements SET internal_client_dept = 'Institutional' WHERE internal_client_dept = 'Institution'`);
  db.exec(`UPDATE engagements SET intake_type = 'SERF' WHERE intake_type = 'SRRF'`);

  // One-time migration: team column for team-based data isolation
  if (!columnExists(db, 'engagements', 'team')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN team TEXT`);
    db.exec(`UPDATE engagements SET team = 'Default Team' WHERE team IS NULL`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_team ON engagements (team)`);

  // One-time migration: creator tracking columns
  if (!columnExists(db, 'engagements', 'created_by_id')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN created_by_id TEXT`);
    db.exec(`ALTER TABLE engagements ADD COLUMN created_by_name TEXT`);
  }

  // One-time migration: linked_from_id for parent/child engagement tracking
  if (!columnExists(db, 'engagements', 'linked_from_id')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN linked_from_id INTEGER`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_linked_from_id ON engagements (linked_from_id)`);

  // One-time migration: filepath for jumping to the project's source folder
  if (!columnExists(db, 'engagements', 'filepath')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN filepath TEXT`);
  }

  // Client registry link: every engagement references its external client by CRN.
  // foreign_keys = ON (see connection.ts) rejects inserts without a valid CRN.
  // The legacy free-text `external_client` column is retired — kept physically to
  // avoid a risky DROP COLUMN, but no longer read or written.
  if (!columnExists(db, 'engagements', 'client_crn')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN client_crn TEXT REFERENCES clients(crn)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_client_crn ON engagements (client_crn)`);
}

function getDb(): DB {
  if (!g._engagementsDb) {
    g._engagementsDb = openSqlite('engagements.sqlite', 'engagements', bootstrap, {
      allowRecreate: false,
    });
    // Fire-and-forget daily safety backup. Errors are logged inside and never
    // bubble up — a backup failure must not keep the app from serving requests.
    maybeRunDailyAutoBackup().catch(() => {});
  }
  return g._engagementsDb;
}

// A handle passed to executeTransaction callbacks. better-sqlite3 transactions
// must be synchronous (an async callback would break atomicity), so these
// methods are synchronous — callers must not `await` inside the callback.
export interface Tx {
  run(sql: string, params?: unknown[]): Database.RunResult;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
}

function makeTx(db: DB): Tx {
  return {
    run: (sql, params = []) => dbRun(db, sql, params),
    get: (sql, params = []) => dbGet(db, sql, params),
    all: (sql, params = []) => dbAll(db, sql, params),
  };
}

// Wraps a callback in a single atomic transaction. Replaces the old manual
// BEGIN/COMMIT/ROLLBACK + write-queue serialization.
export async function executeTransaction(fn: (tx: Tx) => void): Promise<void> {
  const db = getDb();
  db.transaction(() => fn(makeTx(db)))();
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return dbAll<T>(getDb(), sql, params);
}

// Use for mutations that return rows (UPDATE/DELETE/INSERT ... RETURNING).
export async function queryWrite<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return dbAll<T>(getDb(), sql, params);
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  dbRun(getDb(), sql, params);
}
