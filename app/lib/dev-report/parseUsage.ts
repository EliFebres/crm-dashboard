/**
 * Parses daily tool-usage rows pasted from Excel: one row per tool per day, as
 * `Date, Tool, Count` (tab-separated when copied from Excel; commas also work).
 *
 * Pure and dependency-free so the entry page can preview a paste and the API can
 * re-validate the same rows with identical rules.
 */

export interface UsageRow {
  /** ISO date, YYYY-MM-DD. */
  day: string;
  tool: string;
  count: number;
}

export interface UsageParseResult {
  rows: UsageRow[];
  errors: { line: number; message: string }[];
}

/** YYYY-MM-DD, M/D/YYYY or M/D/YY (Excel's short date) → YYYY-MM-DD, or null if invalid. */
export function parseUsageDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (match[3].length === 2) y += 2000;
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseCount(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (!/^\d+(\.0+)?$/.test(s)) return null;
  return Number(s);
}

export function parseUsage(text: string): UsageParseResult {
  const delimiter = text.includes('\t') ? '\t' : ',';
  const lines = text.split(/\r?\n/);
  // Duplicate (day, tool) pairs within one paste are summed; key is case-insensitive
  // on the tool, matching the database's NOCASE column. The first spelling wins.
  const byKey = new Map<string, UsageRow>();
  const errors: UsageParseResult['errors'] = [];
  let sawData = false;

  lines.forEach((rawLine, i) => {
    const line = i + 1;
    if (!rawLine.trim()) return;
    const cells = rawLine.split(delimiter).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
    const [dateCell = '', toolCell = '', countCell = ''] = cells;

    // A header row (e.g. "Date  Tool  Count") is skipped when it's the first line with content.
    if (!sawData && parseUsageDate(dateCell) === null && parseCount(countCell) === null) {
      sawData = true;
      return;
    }
    sawData = true;

    const day = parseUsageDate(dateCell);
    if (!day) return errors.push({ line, message: `"${dateCell}" isn't a date (use YYYY-MM-DD or M/D/YYYY).` });
    if (!toolCell) return errors.push({ line, message: 'Missing tool name.' });
    const count = parseCount(countCell);
    if (count === null) return errors.push({ line, message: `"${countCell}" isn't a whole number.` });

    const key = `${day}|${toolCell.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) existing.count += count;
    else byKey.set(key, { day, tool: toolCell, count });
  });

  const rows = [...byKey.values()].sort((a, b) => a.day.localeCompare(b.day) || a.tool.localeCompare(b.tool));
  return { rows, errors };
}
