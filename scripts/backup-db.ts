/**
 * =============================================================================
 * DuckDB Backup Script
 * =============================================================================
 *
 * Copies the DuckDB database files to a timestamped backup directory and
 * prunes old auto-backup folders older than the retention window (14 days).
 * pre-restore-* snapshots and any other human-named folders are never pruned.
 *
 * The app also runs this automatically once per day on server startup; this
 * CLI is for ad-hoc snapshots.
 *
 * Usage:
 *   npm run db:backup
 *   npm run db:backup -- --force    # bypass the empty-DB guard
 *
 * Requires in .env:
 *   DUCKDB_DIR  — path to directory containing the .duckdb files
 *   BACKUP_DIR  — path to directory where backups will be stored
 *
 * Safe to run while the app is running — DuckDB ensures the main .duckdb file
 * is always in a consistent state. If a .wal file exists, it is copied too so
 * the backup pair can self-recover on first open.
 * =============================================================================
 */

import { config } from 'dotenv';
config({ path: '.env' });

import path from 'path';
import { runBackup } from '../app/lib/db/backupCore';

async function main() {
  const dbDir = process.env.DUCKDB_DIR;
  const backupDir = process.env.BACKUP_DIR;

  if (!dbDir) {
    console.error('ERROR: DUCKDB_DIR is not set. Add it to .env');
    process.exit(1);
  }
  if (!backupDir) {
    console.error('ERROR: BACKUP_DIR is not set. Add it to .env');
    process.exit(1);
  }

  const resolvedDbDir = path.resolve(dbDir);
  const resolvedBackupDir = path.resolve(backupDir);
  const force = process.argv.includes('--force');

  console.log(`\nPCG Dashboard — Database Backup`);
  console.log(`  Source : ${resolvedDbDir}`);
  console.log(`  Dest   : ${resolvedBackupDir}`);
  if (force) console.log('  Force  : on (empty-DB guard bypassed)');
  console.log('');

  const result = await runBackup({
    dbDir: resolvedDbDir,
    backupDir: resolvedBackupDir,
    force,
    log: (m) => console.log(m),
  });

  if (result.skipped) {
    if (result.skipReason === 'no source files') {
      console.log('\nNothing to back up.\n');
      process.exit(0);
    }
    console.warn(`\n⚠  Skipped: ${result.skipReason}`);
    console.warn(`    Re-run with --force if you really mean it.\n`);
    process.exit(2);
  }

  console.log(
    `\nBackup complete.${result.prunedCount ? ` Pruned ${result.prunedCount} old folder(s) older than 14 days.` : ''}\n`
  );
}

main().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
