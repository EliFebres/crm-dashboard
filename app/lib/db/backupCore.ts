import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const DB_FILES = ['engagements.sqlite', 'users.sqlite', 'activity.sqlite', 'portfolio.sqlite'] as const;

// Folder-name pattern for auto-backups. pre-restore-* snapshots and any other
// human-named folders intentionally don't match this and are never auto-pruned.
export const AUTO_BACKUP_PATTERN = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

export const DEFAULT_RETENTION_DAYS = 14;

type Logger = (msg: string) => void;

function pad(n: number): string { return String(n).padStart(2, '0'); }

export function backupTimestamp(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}

export function isAutoBackupDir(name: string): boolean {
  return AUTO_BACKUP_PATTERN.test(name);
}

export function fileSize(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

/**
 * Snapshot a SQLite file using the online backup API. This produces a single
 * consistent .sqlite file (WAL folded in) and is safe to run while the app
 * holds another connection to the source — no EBUSY, no separate WAL/SHM files
 * to copy. Returns false if the source doesn't exist.
 */
export async function backupSqliteFile(srcPath: string, destPath: string): Promise<boolean> {
  if (!fs.existsSync(srcPath)) return false;
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
  const src = new Database(srcPath, { readonly: true });
  try {
    await src.backup(destPath);
  } finally {
    src.close();
  }
  return true;
}

// Number of rows in the engagements table, or -1 if the file/table can't be read.
// Used to detect "empty-DB" snapshots so we don't overwrite a non-empty backup
// history with one.
function engagementRowCount(dbPath: string): number {
  if (!fs.existsSync(dbPath)) return -1;
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`SELECT COUNT(*) AS c FROM engagements`).get() as { c: number };
    return Number(row?.c ?? 0);
  } catch {
    return -1;
  } finally {
    db?.close();
  }
}

export function listAutoBackups(backupDir: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter(isAutoBackupDir).sort();
}

export function mostRecentAutoBackup(backupDir: string): string | null {
  const all = listAutoBackups(backupDir);
  return all.length === 0 ? null : path.join(backupDir, all[all.length - 1]);
}

function parseBackupFolderDate(name: string): Date | null {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

export interface BackupResult {
  backupPath: string | null;
  skipped: boolean;
  skipReason?: string;
  prunedCount: number;
}

// Take a pre-restore safety snapshot. Folder name starts with 'pre-restore-'
// so it never matches AUTO_BACKUP_PATTERN and is never auto-pruned.
export async function takePreRestoreSnapshot(
  dbDir: string,
  backupDir: string,
): Promise<string> {
  const target = path.join(backupDir, `pre-restore-${backupTimestamp()}`);
  fs.mkdirSync(target, { recursive: true });
  for (const f of DB_FILES) {
    await backupSqliteFile(path.join(dbDir, f), path.join(target, f));
  }
  return target;
}

// Snapshot each DB file into a new timestamped folder under backupDir, then
// prune folders older than retentionDays. Refuses to snapshot an empty
// engagements DB over a non-empty history unless `force` is true.
export async function runBackup(opts: {
  dbDir: string;
  backupDir: string;
  retentionDays?: number;
  force?: boolean;
  log?: Logger;
}): Promise<BackupResult> {
  const {
    dbDir,
    backupDir,
    retentionDays = DEFAULT_RETENTION_DAYS,
    force = false,
    log = () => {},
  } = opts;

  fs.mkdirSync(backupDir, { recursive: true });

  if (!force) {
    const currentCount = engagementRowCount(path.join(dbDir, 'engagements.sqlite'));
    const lastDir = mostRecentAutoBackup(backupDir);
    if (lastDir) {
      const lastCount = engagementRowCount(path.join(lastDir, 'engagements.sqlite'));
      if (currentCount <= 0 && lastCount > 0) {
        const reason =
          `engagements.sqlite has ${currentCount < 0 ? 'unreadable' : '0'} rows but the most recent ` +
          `backup has ${lastCount}. Refusing to overwrite the backup history with an empty snapshot. ` +
          `Pass { force: true } or use '--force' on the CLI to override.`;
        log(`SKIP: ${reason}`);
        return { backupPath: null, skipped: true, skipReason: reason, prunedCount: 0 };
      }
    }
  }

  const ts = backupTimestamp();
  const target = path.join(backupDir, ts);
  fs.mkdirSync(target);

  let any = false;
  for (const f of DB_FILES) {
    const src = path.join(dbDir, f);
    const dest = path.join(target, f);
    try {
      const copied = await backupSqliteFile(src, dest);
      if (copied) {
        const sz = (fs.statSync(dest).size / 1024).toFixed(1);
        log(`  ✓ ${f} (${sz} KB)`);
        any = true;
      } else {
        log(`  - ${f} not found, skipped`);
      }
    } catch (err) {
      log(`  ! ${f} backup failed: ${(err as Error).message}`);
    }
  }

  if (!any) {
    fs.rmSync(target, { recursive: true });
    log('No database files found. Nothing to back up.');
    return { backupPath: null, skipped: true, skipReason: 'no source files', prunedCount: 0 };
  }

  const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
  let pruned = 0;
  for (const name of fs.readdirSync(backupDir)) {
    if (!isAutoBackupDir(name)) continue;   // skip pre-restore-*, custom names, etc.
    if (name === ts) continue;              // never prune the one we just made
    const folderDate = parseBackupFolderDate(name);
    if (folderDate && folderDate.getTime() < cutoff) {
      fs.rmSync(path.join(backupDir, name), { recursive: true });
      log(`  ✗ pruned ${name}`);
      pruned++;
    }
  }

  return { backupPath: target, skipped: false, prunedCount: pruned };
}
