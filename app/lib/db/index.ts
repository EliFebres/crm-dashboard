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

  // One-time migration: crn_pending flags clients registered before their real CRN
  // is known. Such clients carry a system-generated placeholder CRN (PENDING-000001,
  // …) so interactions can be created now and the real CRN filled in later.
  if (!columnExists(db, 'clients', 'crn_pending')) {
    db.exec(`ALTER TABLE clients ADD COLUMN crn_pending INTEGER NOT NULL DEFAULT 0`);
  }

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

  // One-time migration: optional free-text project identifier. Nullable — ad-hoc
  // interactions often have none, and every pre-existing row predates the column.
  // The client-models export surfaces it by looking up the client's most recent
  // interaction that carries one (models themselves have no project identity).
  if (!columnExists(db, 'engagements', 'project_id')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN project_id TEXT`);
  }

  // Client registry link: every engagement references its external client by CRN.
  // foreign_keys = ON (see connection.ts) rejects inserts without a valid CRN.
  // The legacy free-text `external_client` column is retired — kept physically to
  // avoid a risky DROP COLUMN, but no longer read or written.
  if (!columnExists(db, 'engagements', 'client_crn')) {
    db.exec(`ALTER TABLE engagements ADD COLUMN client_crn TEXT REFERENCES clients(crn)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_client_crn ON engagements (client_crn)`);

  // Client-level model portfolios. A client (CRN) can run several models (large- vs
  // small-client, per-office, 60/40 vs 100/0); exactly one is flagged is_main. These
  // are canonical + shared across the client's interactions (replaces the old single
  // per-engagement portfolio as the source of truth). ON DELETE CASCADE ties them to
  // the client; a CRN rename cascades manually (see clients/[crn]/route.ts).
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_models (
      id         TEXT PRIMARY KEY,
      crn        TEXT NOT NULL REFERENCES clients(crn) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      is_main    INTEGER NOT NULL DEFAULT 0,
      aum        INTEGER,
      holdings   TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_client_models_crn ON client_models (crn);
  `);

  // One-time migration: which interaction logged this model. The models export reads
  // that engagement's project_id through this link, so correcting a Project ID on the
  // interaction flows to the export with no stale copies. NULL until a model is logged
  // from an interaction (models predating this column, and saves made from
  // Settings → Client Management, have no interaction context). ON DELETE SET NULL so
  // deleting an interaction un-attributes its models rather than removing them.
  if (!columnExists(db, 'client_models', 'logged_engagement_id')) {
    db.exec(
      `ALTER TABLE client_models
         ADD COLUMN logged_engagement_id INTEGER REFERENCES engagements(id) ON DELETE SET NULL`
    );
  }
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_client_models_logged_engagement_id
       ON client_models (logged_engagement_id)`
  );

  // One-time seed: fold each client's most-recent non-empty legacy engagement
  // portfolio into a single main model named "Logged Portfolio". Gated by a
  // migration marker so it runs EXACTLY once — a per-crn guard would resurrect the
  // legacy portfolio if a user later deletes all of a client's models and reboots.
  // The legacy engagements.portfolio column is left in place (retired, not read by
  // the new modal) — same approach as the old external_client column.
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const SEED_CLIENT_MODELS = 'seed_client_models_from_legacy_portfolio_v1';
  if (!dbGet(db, `SELECT 1 AS x FROM app_migrations WHERE name = ?`, [SEED_CLIENT_MODELS])) {
    db.exec(`
      INSERT INTO client_models (id, crn, name, is_main, aum, holdings, sort_order)
      SELECT lower(hex(randomblob(16))), t.client_crn, 'Logged Portfolio', 1, NULL, t.portfolio, 0
      FROM (
        SELECT e.client_crn, e.portfolio,
               ROW_NUMBER() OVER (PARTITION BY e.client_crn
                                  ORDER BY e.date_started DESC, e.id DESC) AS rn
        FROM engagements e
        WHERE e.client_crn IS NOT NULL
          AND e.portfolio IS NOT NULL
          AND e.portfolio != ''
          AND e.portfolio != '[]'
      ) t
      WHERE t.rn = 1
    `);
    dbRun(db, `INSERT INTO app_migrations (name) VALUES (?)`, [SEED_CLIENT_MODELS]);
  }

  // Managed internal-client departments. The department NAME lives denormalized on
  // engagements.internal_client_dept; this table makes the set editable (add/rename/
  // delete + a chart color) and a rename cascades into engagements + internal_clients
  // atomically (see app/lib/db/departments.ts). Kept in this DB — not users.sqlite —
  // precisely so that cascade can share one transaction with engagements.
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#71717a',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_name_nocase ON departments (name COLLATE NOCASE);
  `);

  // Seed the canonical four departments FIRST, with the exact colors the department
  // breakdown chart used when they were hardcoded — so charts render identically
  // after this migration. Gated by a one-time marker so it runs EXACTLY once: a
  // bare INSERT OR IGNORE would resurrect a renamed built-in on the next restart
  // (the unique-name index no longer collides once "Advisory" is renamed). Existing
  // DBs (table already populated) just record the marker without re-seeding, so
  // prior renames survive untouched.
  const SEED_DEPARTMENTS = 'seed_canonical_departments_v1';
  if (!dbGet(db, `SELECT 1 AS x FROM app_migrations WHERE name = ?`, [SEED_DEPARTMENTS])) {
    const existing = dbGet<{ c: number }>(db, `SELECT COUNT(*) AS c FROM departments`);
    if (!existing || existing.c === 0) {
      db.exec(`
        INSERT OR IGNORE INTO departments (id, name, color, sort_order) VALUES
          (lower(hex(randomblob(16))), 'Advisory',      '#a5f3fc', 0),
          (lower(hex(randomblob(16))), 'Brokerage',     '#22d3ee', 1),
          (lower(hex(randomblob(16))), 'Institutional', '#0e7490', 2),
          (lower(hex(randomblob(16))), 'Retirement',    '#67e8f9', 3);
      `);
    }
    dbRun(db, `INSERT INTO app_migrations (name) VALUES (?)`, [SEED_DEPARTMENTS]);
  }

  // Backfill any other department already present in real engagement data with a
  // neutral color, so it becomes a managed option instead of an orphan value.
  db.exec(`
    INSERT OR IGNORE INTO departments (id, name, color, sort_order)
    SELECT lower(hex(randomblob(16))), internal_client_dept, '#71717a', 100
    FROM (SELECT DISTINCT internal_client_dept FROM engagements)
    WHERE internal_client_dept IS NOT NULL AND trim(internal_client_dept) != ''
  `);

  // Managed internal-client registry. The name + department live denormalized on
  // engagements; this table makes the pick-list editable and lets a client exist
  // before any engagement uses it. Global (not team-scoped), like `clients`.
  db.exec(`
    CREATE TABLE IF NOT EXISTS internal_clients (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      department      TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by_id   TEXT,
      created_by_name TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_clients_name_nocase ON internal_clients (name COLLATE NOCASE);
  `);

  // Seed the registry from the distinct internal clients already in engagement data.
  // A name that appears under two departments keeps the first seen (unique-name index).
  db.exec(`
    INSERT OR IGNORE INTO internal_clients (id, name, department)
    SELECT lower(hex(randomblob(16))), internal_client_name, internal_client_dept
    FROM (SELECT DISTINCT internal_client_name, internal_client_dept FROM engagements)
    WHERE internal_client_name IS NOT NULL AND trim(internal_client_name) != ''
  `);

  // Managed intake types. The NAME is denormalized on engagements.intake_type; this
  // table makes the set editable (add/rename/delete + a chart color) and a rename
  // cascades into engagements atomically (see app/lib/db/intakeTypes.ts). The three
  // built-ins carry a stable `role` so business logic (Ad-Hoc channel, KPI buckets)
  // survives a rename — role-bearing rows can be renamed but not deleted.
  db.exec(`
    CREATE TABLE IF NOT EXISTS intake_types (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#71717a',
      sort_order INTEGER NOT NULL DEFAULT 0,
      role       TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_types_name_nocase ON intake_types (name COLLATE NOCASE);
  `);

  // Seed the three canonical intake types with the exact colors the KPI charts used
  // when they were hardcoded (INTAKE_COLOR in app/components/dashboard/kpis/utils.ts).
  // Gated by a one-time marker (see the departments seed above) so a renamed built-in
  // is never resurrected on restart.
  const SEED_INTAKE_TYPES = 'seed_canonical_intake_types_v1';
  if (!dbGet(db, `SELECT 1 AS x FROM app_migrations WHERE name = ?`, [SEED_INTAKE_TYPES])) {
    const existing = dbGet<{ c: number }>(db, `SELECT COUNT(*) AS c FROM intake_types`);
    if (!existing || existing.c === 0) {
      db.exec(`
        INSERT OR IGNORE INTO intake_types (id, name, color, sort_order, role) VALUES
          (lower(hex(randomblob(16))), 'IRQ',    '#3b82f6', 0, 'irq'),
          (lower(hex(randomblob(16))), 'SERF',   '#10b981', 1, 'serf'),
          (lower(hex(randomblob(16))), 'Ad-Hoc', '#ec4899', 2, 'ad_hoc');
      `);
    }
    dbRun(db, `INSERT INTO app_migrations (name) VALUES (?)`, [SEED_INTAKE_TYPES]);
  }

  // Backfill any other intake type already present in real engagement data as a
  // managed (custom) option, so it isn't an orphan value.
  db.exec(`
    INSERT OR IGNORE INTO intake_types (id, name, color, sort_order, role)
    SELECT lower(hex(randomblob(16))), intake_type, '#71717a', 100, NULL
    FROM (SELECT DISTINCT intake_type FROM engagements)
    WHERE intake_type IS NOT NULL AND trim(intake_type) != ''
  `);

  // Managed project types (flat global list). The NAME is denormalized on
  // engagements.type; a rename cascades into engagements (see projectTypes.ts). The
  // 'PCR' built-in carries role 'pcr' so PCR-excluding KPI SQL survives a rename.
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_types (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#71717a',
      sort_order INTEGER NOT NULL DEFAULT 0,
      role       TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_project_types_name_nocase ON project_types (name COLLATE NOCASE);
  `);

  // Seed the canonical project types with the exact colors the KPI charts used when
  // they were hardcoded (PROJECT_TYPE_COLOR in app/components/dashboard/kpis/utils.ts).
  // Gated by a one-time marker (see the departments seed above) so a renamed built-in
  // is never resurrected on restart.
  const SEED_PROJECT_TYPES = 'seed_canonical_project_types_v1';
  if (!dbGet(db, `SELECT 1 AS x FROM app_migrations WHERE name = ?`, [SEED_PROJECT_TYPES])) {
    const existing = dbGet<{ c: number }>(db, `SELECT COUNT(*) AS c FROM project_types`);
    if (!existing || existing.c === 0) {
      db.exec(`
        INSERT OR IGNORE INTO project_types (id, name, color, sort_order, role) VALUES
          (lower(hex(randomblob(16))), 'Meeting',            '#8b5cf6', 0, NULL),
          (lower(hex(randomblob(16))), 'Discovery Meeting',  '#22d3ee', 1, NULL),
          (lower(hex(randomblob(16))), 'Data Request',       '#a5f3fc', 2, NULL),
          (lower(hex(randomblob(16))), 'Data Update',        '#f97316', 3, NULL),
          (lower(hex(randomblob(16))), 'PCR',                '#f43f5e', 4, 'pcr'),
          (lower(hex(randomblob(16))), 'Follow-up Material', '#f59e0b', 5, NULL),
          (lower(hex(randomblob(16))), 'Follow-up Meeting',  '#10b981', 6, NULL),
          (lower(hex(randomblob(16))), 'Other',              '#71717a', 7, NULL);
      `);
    }
    dbRun(db, `INSERT INTO app_migrations (name) VALUES (?)`, [SEED_PROJECT_TYPES]);
  }

  // Backfill any other project type already present in real engagement data.
  db.exec(`
    INSERT OR IGNORE INTO project_types (id, name, color, sort_order, role)
    SELECT lower(hex(randomblob(16))), type, '#71717a', 100, NULL
    FROM (SELECT DISTINCT type FROM engagements)
    WHERE type IS NOT NULL AND trim(type) != ''
  `);
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
// BEGIN/COMMIT/ROLLBACK + write-queue serialization. The callback's return value
// (if any) is passed through, so callers can compute a result inside the tx.
export async function executeTransaction<T = void>(fn: (tx: Tx) => T): Promise<T> {
  const db = getDb();
  return db.transaction(() => fn(makeTx(db)))();
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
