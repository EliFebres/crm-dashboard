/**
 * =============================================================================
 * DuckDB Restore Script
 * =============================================================================
 *
 * Restores database files from a backup created by backup-db.ts.
 *
 * Usage:
 *   npm run db:restore                              # Restore most recent backup (all DBs)
 *   npm run db:restore -- --backup 2026-03-27_02-00-00
 *   npm run db:restore -- --db engagements
 *   npm run db:restore -- --db users
 *   npm run db:restore -- --yes                     # Skip the y/N prompt
 *   npm run db:restore -- --force                   # Bypass the size-check guard
 *
 * Safety rails:
 *   - Before overwriting, the current .duckdb files are copied to
 *     Backups/pre-restore-<timestamp>/ (never auto-pruned). If you realize
 *     afterwards that the restore was wrong, point --backup at that folder.
 *   - If the backup's engagements.duckdb is >20% smaller than the current
 *     engagements.duckdb, the restore is refused unless --force is passed.
 *     Catches the "accidentally restore an empty backup over live data" case.
 *
 * IMPORTANT: Stop the app server before restoring.
 * DuckDB requires exclusive access to write to the database files.
 * =============================================================================
 */

import { config } from 'dotenv';
config({ path: '.env' });

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import {
  DB_FILES,
  listAutoBackups,
  fileSize,
  takePreRestoreSnapshot,
} from '../app/lib/db/backupCore';

// Refuse a restore when the backup is <80% the size of the current DB, unless
// --force. Captures the empty-over-live footgun while allowing normal "roll
// back a day" restores that trim ~1 day of growth.
const SHRINK_THRESHOLD = 0.8;

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
}

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

  if (!fs.existsSync(resolvedBackupDir)) {
    console.error(`ERROR: BACKUP_DIR does not exist: ${resolvedBackupDir}`);
    console.error('Run "npm run db:backup" first.');
    process.exit(1);
  }

  const backups = listAutoBackups(resolvedBackupDir).reverse(); // newest first

  if (backups.length === 0) {
    console.error('No backups found in BACKUP_DIR.');
    process.exit(1);
  }

  const requestedBackup = getArg('--backup');
  let chosen: string;
  if (requestedBackup) {
    // Allow non-standard folder names (e.g. pre-restore-*) by falling through
    // to a filesystem existence check.
    const candidate = path.join(resolvedBackupDir, requestedBackup);
    if (!fs.existsSync(candidate)) {
      console.error(`ERROR: Backup "${requestedBackup}" not found.`);
      console.error('\nAvailable auto-backups:');
      backups.forEach((b, i) => console.error(`  ${i === 0 ? '(latest) ' : '         '}${b}`));
      process.exit(1);
    }
    chosen = requestedBackup;
  } else {
    chosen = backups[0];
  }

  const dbArg = getArg('--db');
  let filesToRestore: readonly string[];
  if (!dbArg || dbArg === 'both' || dbArg === 'all') {
    filesToRestore = DB_FILES;
  } else if (dbArg === 'engagements') {
    filesToRestore = ['engagements.duckdb'];
  } else if (dbArg === 'users') {
    filesToRestore = ['users.duckdb'];
  } else if (dbArg === 'activity') {
    filesToRestore = ['activity.duckdb'];
  } else {
    console.error(`ERROR: Unknown --db value "${dbArg}". Use: engagements, users, activity, or all`);
    process.exit(1);
  }

  const chosenDir = path.join(resolvedBackupDir, chosen);
  const force = hasFlag('--force');

  console.log(`\nCRM Dashboard — Database Restore`);
  console.log(`  Backup : ${chosen}`);
  console.log(`  Target : ${resolvedDbDir}`);
  console.log(`  Files  : ${filesToRestore.join(', ')}`);
  if (force) console.log('  Force  : on (size-check guard bypassed)');
  console.log('');
  console.log('  ⚠  STOP THE APP SERVER before continuing.');
  console.log('     Restoring while the app is running will cause data corruption.');
  console.log('');

  // Guard: for each file being restored, compare source vs. current size.
  // If source is significantly smaller, something is probably off — refuse
  // unless --force.
  const shrinking: { file: string; srcSize: number; destSize: number }[] = [];
  for (const f of filesToRestore) {
    const srcSize = fileSize(path.join(chosenDir, f));
    const destSize = fileSize(path.join(resolvedDbDir, f));
    if (destSize === 0 || srcSize === 0) continue; // nothing to compare
    if (srcSize < destSize * SHRINK_THRESHOLD) {
      shrinking.push({ file: f, srcSize, destSize });
    }
  }
  if (shrinking.length > 0) {
    console.error('  ⚠  Size-check guard tripped:');
    for (const s of shrinking) {
      const pct = ((s.srcSize / s.destSize) * 100).toFixed(1);
      console.error(
        `       ${s.file}: backup ${s.srcSize} B  <  current ${s.destSize} B  (backup is ${pct}% of current)`
      );
    }
    if (!force) {
      console.error('');
      console.error('  Restoring would overwrite a larger current DB with a smaller backup.');
      console.error('  If this is intentional (e.g., rolling back real changes), re-run with --force.');
      console.error('  Aborting.\n');
      process.exit(2);
    }
    console.error('  Proceeding because --force was passed.\n');
  }

  if (!hasFlag('--yes')) {
    const ok = await confirm('  Proceed with restore? (y/N) ');
    if (!ok) {
      console.log('\nRestore cancelled.');
      process.exit(0);
    }
    console.log('');
  }

  fs.mkdirSync(resolvedDbDir, { recursive: true });

  // Safety net: snapshot the current DB state before we touch it. Even if the
  // restore turns out to be wrong, this gives us a way back to "what it was
  // 10 seconds ago."
  let snapshotPath: string;
  try {
    snapshotPath = takePreRestoreSnapshot(resolvedDbDir, resolvedBackupDir);
    console.log(`  📸 pre-restore snapshot: ${path.basename(snapshotPath)}`);
  } catch (err) {
    console.error('\nFailed to take pre-restore safety snapshot:', err);
    console.error('Aborting — refusing to restore without a snapshot first.');
    console.error('Fix the error (disk space? permissions?) and retry.\n');
    process.exit(1);
  }

  for (const dbFile of filesToRestore) {
    const srcMain = path.join(chosenDir, dbFile);
    const srcWal  = `${srcMain}.wal`;
    const destMain = path.join(resolvedDbDir, dbFile);
    const destWal  = `${destMain}.wal`;

    if (!fs.existsSync(srcMain)) {
      console.log(`  - ${dbFile} not in this backup, skipped`);
      continue;
    }

    if (fs.existsSync(destWal)) {
      fs.rmSync(destWal);
    }

    fs.copyFileSync(srcMain, destMain);
    const size = (fs.statSync(destMain).size / 1024).toFixed(1);

    if (fs.existsSync(srcWal)) {
      fs.copyFileSync(srcWal, destWal);
      console.log(`  ✓ ${dbFile} (${size} KB) + .wal`);
    } else {
      console.log(`  ✓ ${dbFile} (${size} KB)`);
    }
  }

  console.log(`\nRestore complete. If anything looks wrong, roll back with:`);
  console.log(`  npm run db:restore -- --backup ${path.basename(snapshotPath)} --yes --force\n`);
  console.log(`You can now restart the app server.\n`);
}

main().catch(err => {
  console.error('Restore failed:', err);
  process.exit(1);
});
