/**
 * =============================================================================
 * DuckDB Seed Script
 * =============================================================================
 *
 * Creates the database schema (tables, indexes, sequence) and optionally
 * populates it with mock engagement data for development/testing.
 *
 * Usage:
 *   npx tsx scripts/seed-db.ts              # Create schema only
 *   npx tsx scripts/seed-db.ts --with-mock  # Schema + seed with mock data
 *
 * Requires DUCKDB_DIR to be set (via .env or environment):
 *   DUCKDB_DIR=./data npx tsx scripts/seed-db.ts --with-mock
 * =============================================================================
 */

// Load .env before anything else
import { config } from 'dotenv';
config({ path: '.env' });

import { DuckDBInstance } from '@duckdb/node-api';
import path from 'path';
import fs from 'fs';
import { engagements } from '../app/lib/data/engagements';

async function main() {
  const dbDir = process.env.DUCKDB_DIR;
  if (!dbDir) {
    console.error('ERROR: DUCKDB_DIR environment variable is not set.');
    console.error('Create a .env file with: DUCKDB_DIR=./data');
    process.exit(1);
  }

  // Ensure the data directory exists
  const resolvedDir = path.resolve(dbDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
    console.log(`Created directory: ${resolvedDir}`);
  }

  const resolved = path.join(resolvedDir, 'engagements.duckdb');
  console.log(`Connecting to DuckDB at: ${resolved}`);
  const instance = await DuckDBInstance.create(resolved);
  const conn = await instance.connect();

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------
  console.log('Creating schema...');

  await conn.run(`
    CREATE TABLE IF NOT EXISTS engagements (
      id                   INTEGER PRIMARY KEY,
      external_client      VARCHAR,
      internal_client_name VARCHAR    NOT NULL,
      internal_client_dept VARCHAR    NOT NULL,
      intake_type          VARCHAR    NOT NULL,
      ad_hoc_channel       VARCHAR,
      type                 VARCHAR    NOT NULL,
      team_members         VARCHAR    NOT NULL DEFAULT '[]',
      department           VARCHAR    NOT NULL,
      date_started         DATE       NOT NULL,
      date_finished        DATE,
      status               VARCHAR    NOT NULL,
      portfolio_logged     BOOLEAN    NOT NULL DEFAULT FALSE,
      portfolio            VARCHAR,
      nna                  BIGINT,
      notes                VARCHAR,
      tickers_mentioned    VARCHAR,
      linked_from_id       INTEGER
    )
  `);

  await conn.run(`CREATE SEQUENCE IF NOT EXISTS engagements_id_seq START 1`);

  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_date_started ON engagements (date_started)
  `);
  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_status ON engagements (status)
  `);
  await conn.run(`
    CREATE INDEX IF NOT EXISTS idx_department ON engagements (department)
  `);

  console.log('Schema created successfully.');

  // -------------------------------------------------------------------------
  // Optional: seed with mock data
  // -------------------------------------------------------------------------
  const withMock = process.argv.includes('--with-mock');
  if (!withMock) {
    console.log('Done. Run with --with-mock to populate with mock data.');
    instance.closeSync();
    return;
  }

  // Check if table already has data
  const countResult = await conn.runAndReadAll('SELECT COUNT(*) AS cnt FROM engagements');
  const countRows = countResult.getRowObjects() as Record<string, unknown>[];
  const existingCount = Number(countRows[0]?.cnt ?? 0);
  if (existingCount > 0) {
    console.log(`Table already has ${existingCount} rows. Skipping seed.`);
    console.log('To re-seed, delete the database file and run again.');
    instance.closeSync();
    return;
  }

  console.log(`Seeding ${engagements.length} mock engagements...`);

  // Use individual INSERT statements (simpler than Appender for ~500 rows)
  let inserted = 0;
  for (const e of engagements) {
    const dateStarted = parseDisplayDate(e.dateStarted);
    const dateFinished = e.dateFinished === '—' ? null : parseDisplayDate(e.dateFinished);

    await conn.run(
      `INSERT INTO engagements (
        id, external_client, internal_client_name, internal_client_dept,
        intake_type, ad_hoc_channel, type, team_members, department,
        date_started, date_finished, status, portfolio_logged, portfolio,
        nna, notes, tickers_mentioned
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.id,
        e.externalClient ?? null,
        e.internalClient.name,
        e.internalClient.gcgDepartment,
        e.intakeType,
        e.adHocChannel ?? null,
        e.type,
        JSON.stringify(e.teamMembers),
        e.department,
        dateStarted,
        dateFinished,
        e.status,
        e.portfolioLogged,
        e.portfolio ? JSON.stringify(e.portfolio) : null,
        e.nna ?? null,
        e.notes ?? null,
        e.tickersMentioned ? JSON.stringify(e.tickersMentioned) : null,
      ]
    );
    inserted++;
    if (inserted % 100 === 0) {
      console.log(`  Inserted ${inserted}/${engagements.length}...`);
    }
  }

  // Reset the sequence so new inserts get IDs beyond the seeded data
  const maxId = Math.max(...engagements.map(e => e.id));
  await conn.run(`CREATE OR REPLACE SEQUENCE engagements_id_seq START ${maxId + 1}`);

  console.log(`Done. ${inserted} rows inserted. Sequence starts at ${maxId + 1}.`);
  instance.closeSync();
}

/**
 * Converts a display date string like "Jan 15, 2025" to ISO "2025-01-15".
 */
function parseDisplayDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toISOString().split('T')[0];
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
