/**
 * =============================================================================
 * One-time DuckDB → SQLite Data Migration
 * =============================================================================
 *
 * Copies all rows from the legacy DuckDB databases into the new SQLite
 * databases. Run this ONCE when cutting over from DuckDB to better-sqlite3.
 *
 * The SQLite schema is created by the app's own bootstrap (single source of
 * truth); this script only moves data. Existing engagement IDs (and note /
 * linked_from_id relationships) are preserved.
 *
 * PREREQUISITES:
 *   1. Stop the app server.
 *   2. Temporarily reinstall the DuckDB driver (it was removed from deps):
 *        npm install --no-save @duckdb/node-api
 *   3. Make sure your .env points SQLITE_DIR at the destination (local disk).
 *
 * USAGE:
 *   # Reads .duckdb files from --source, writes .sqlite files to SQLITE_DIR:
 *   npx tsx scripts/migrate-duckdb-to-sqlite.ts --source "J:/CRM/data"
 *
 *   # If old .duckdb and new .sqlite live in the same folder, --source can be
 *   # omitted (defaults to SQLITE_DIR / DUCKDB_DIR).
 *
 * SAFETY:
 *   - Run against a COPY of production data first and verify the row counts
 *     printed at the end match the source.
 *   - The script refuses to import into a destination table that already has
 *     rows, so re-running won't duplicate data.
 *   - Keep the original .duckdb files until you've verified the app against the
 *     migrated SQLite data.
 * =============================================================================
 */

import { config } from 'dotenv';
config({ path: '.env' });

import path from 'path';
import fs from 'fs';

// Destination is whatever the app uses; set SQLITE_DIR in .env.
const destDir = process.env.SQLITE_DIR || process.env.DUCKDB_DIR;
if (!destDir) {
  console.error('ERROR: SQLITE_DIR is not set. Add it to .env (destination for the .sqlite files).');
  process.exit(1);
}

function getArg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const sourceDir = path.resolve(getArg('--source') || destDir);
const resolvedDest = path.resolve(destDir);

// Each DuckDB file → SQLite file, with the tables to copy (in FK-safe order).
const PLAN = [
  { duck: 'engagements.duckdb', sqlite: 'engagements.sqlite', tables: ['engagements', 'engagement_notes'] },
  { duck: 'users.duckdb',       sqlite: 'users.sqlite',       tables: ['users', 'team_members'] },
  { duck: 'activity.duckdb',    sqlite: 'activity.sqlite',    tables: ['activity_logs', 'user_presence'] },
] as const;

// better-sqlite3 only binds numbers/strings/bigint/Buffer/null. Normalize the
// JS values DuckDB returns (booleans, Dates, parsed JSON objects) accordingly.
function normalizeValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
}

async function main() {
  // Dynamic import via a non-literal specifier so the (temporarily installed)
  // dependency isn't required for normal type-checks / app builds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let DuckDBInstance: any;
  try {
    const pkg = '@duckdb/node-api';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import(pkg)) as any;
    DuckDBInstance = mod.DuckDBInstance;
  } catch {
    console.error('ERROR: @duckdb/node-api is not installed.');
    console.error('Install it temporarily for this migration:');
    console.error('  npm install --no-save @duckdb/node-api');
    process.exit(1);
  }

  // Point the app's SQLite layer at the destination and let it build the schema.
  process.env.SQLITE_DIR = resolvedDest;
  const Database = (await import('better-sqlite3')).default;

  console.log(`\nDuckDB → SQLite migration`);
  console.log(`  Source (.duckdb): ${sourceDir}`);
  console.log(`  Dest   (.sqlite): ${resolvedDest}\n`);

  for (const { duck, sqlite, tables } of PLAN) {
    const duckPath = path.join(sourceDir, duck);
    if (!fs.existsSync(duckPath)) {
      console.log(`- ${duck} not found, skipping`);
      continue;
    }

    // Trigger the app bootstrap for this DB so the schema + migrations exist.
    if (sqlite === 'engagements.sqlite') await import('../app/lib/db');
    else if (sqlite === 'users.sqlite') await import('../app/lib/db/users');
    else await import('../app/lib/db/activity');

    const sqlitePath = path.join(resolvedDest, sqlite);
    const sdb = new Database(sqlitePath);

    const instance = await DuckDBInstance.create(duckPath);
    const conn = await instance.connect();

    for (const table of tables) {
      const existing = sdb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
      if (existing.c > 0) {
        console.log(`  • ${table}: destination already has ${existing.c} rows — skipping`);
        continue;
      }

      const reader = await conn.runAndReadAll(`SELECT * FROM ${table}`);
      const rows = reader.getRowObjects() as Record<string, unknown>[];
      if (rows.length === 0) {
        console.log(`  • ${table}: 0 source rows`);
        continue;
      }

      const cols = Object.keys(rows[0]);
      const insert = sdb.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      );
      const insertMany = sdb.transaction((batch: Record<string, unknown>[]) => {
        for (const r of batch) insert.run(cols.map((c) => normalizeValue(r[c])));
      });
      insertMany(rows);

      const after = sdb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
      console.log(`  ✓ ${table}: ${rows.length} source → ${after.c} dest`);
    }

    instance.closeSync();
    sdb.close();
  }

  console.log('\nMigration complete. Verify the app against the migrated data before removing the .duckdb files.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
