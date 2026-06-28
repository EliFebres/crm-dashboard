/**
 * =============================================================================
 * SQLite Seed Script
 * =============================================================================
 *
 * Creates the database schema (via the app's own bootstrap) and optionally
 * populates it with mock engagement data for development/testing.
 *
 * Usage:
 *   npx tsx scripts/seed-db.ts              # Create schema only
 *   npx tsx scripts/seed-db.ts --with-mock  # Schema + seed with mock data
 *
 * Requires SQLITE_DIR to be set (via .env or environment):
 *   SQLITE_DIR=./data npx tsx scripts/seed-db.ts --with-mock
 * =============================================================================
 */

// Load .env before anything else
import { config } from 'dotenv';
config({ path: '.env' });

import { query, executeTransaction } from '../app/lib/db';
import { engagements, clients } from '../app/lib/data/engagements';

async function main() {
  const dbDir = process.env.SQLITE_DIR || process.env.DUCKDB_DIR;
  if (!dbDir) {
    console.error('ERROR: SQLITE_DIR environment variable is not set.');
    console.error('Create a .env file with: SQLITE_DIR=./data');
    process.exit(1);
  }

  // The first query triggers the app's bootstrap, which creates the schema and
  // runs all idempotent migrations — keeping a single source of truth.
  console.log('Ensuring schema...');
  const countRows = await query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM engagements');
  console.log('Schema ready.');

  const withMock = process.argv.includes('--with-mock');
  if (!withMock) {
    console.log('Done. Run with --with-mock to populate with mock data.');
    return;
  }

  const existingCount = Number(countRows[0]?.cnt ?? 0);
  if (existingCount > 0) {
    console.log(`Table already has ${existingCount} rows. Skipping seed.`);
    console.log('To re-seed, delete the database file and run again.');
    return;
  }

  console.log(`Seeding ${clients.length} clients and ${engagements.length} mock engagements...`);

  let inserted = 0;
  await executeTransaction((tx) => {
    // Clients must exist before engagements (client_crn foreign key).
    for (const c of clients) {
      tx.run(
        `INSERT INTO clients (crn, name, created_by_name) VALUES (?, ?, ?)`,
        [c.crn, c.name, 'Seed']
      );
    }

    for (const e of engagements) {
      const dateStarted = parseDisplayDate(e.dateStarted);
      const dateFinished = e.dateFinished === '—' ? null : parseDisplayDate(e.dateFinished);

      tx.run(
        `INSERT INTO engagements (
          id, client_crn, internal_client_name, internal_client_dept,
          intake_type, ad_hoc_channel, type, team_members, department,
          date_started, date_finished, status, portfolio_logged, portfolio,
          nna, notes, tickers_mentioned, team
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.clientCrn,
          e.internalClient.name,
          e.internalClient.clientDept,
          e.intakeType,
          e.adHocChannel ?? null,
          e.type,
          JSON.stringify(e.teamMembers),
          e.department,
          dateStarted,
          dateFinished,
          e.status,
          e.portfolioLogged ? 1 : 0,
          e.portfolio ? JSON.stringify(e.portfolio) : null,
          e.nna ?? null,
          e.notes ?? null,
          e.tickersMentioned ? JSON.stringify(e.tickersMentioned) : null,
          'Default Team',
        ]
      );
      inserted++;
    }
  });

  console.log(`Done. ${inserted} rows inserted.`);
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
