/**
 * Data layer for the founder's development report: monthly code stats, the tool
 * inventory, and daily tool usage (all in engagements.sqlite; tables created in
 * index.ts). Usage rows reference tools by NAME (case-insensitive), so a tool
 * rename cascades into dev_tool_usage in the same transaction.
 *
 * Everything reported is year to date: Jan 1 of the current year through today.
 */
import { randomUUID } from 'crypto';
import { query, executeTransaction, hasDb } from './index';
import { localTodayISO } from './dateUtils';
import { DEV_REPORT_SCHEMA } from './devReportSchema';
import { parseUsageDate, type UsageRow } from '../dev-report/parseUsage';
import {
  DEV_TOOL_PALETTE,
  DEV_TOOL_STATUSES,
  type DevCodeMonth,
  type DevReportData,
  type DevReportInputs,
  type DevTool,
  type DevToolInput,
  type DevToolStatus,
} from '../api/dev-report';

/** Carries an HTTP status so route handlers can translate it to a response. */
export class DevReportError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DevReportError';
  }
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_USAGE_ROWS = 50_000;
const MAX_TOOL_NAME = 100;

/**
 * Creates the tables if they're missing (once per process). The bootstrap in index.ts
 * normally does this, but only when a connection opens; see devReportSchema.ts.
 */
let schemaReady = false;
async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await executeTransaction(tx => {
    for (const sql of DEV_REPORT_SCHEMA) tx.run(sql);
  });
  schemaReady = true;
}

/** The YTD window: Jan 1 → today (local), plus the current year and month key. */
function ytdWindow() {
  const today = localTodayISO();
  const year = Number(today.slice(0, 4));
  return { year, start: `${year}-01-01`, end: today, currentMonth: today.slice(0, 7) };
}

// =============================================================================
// VALIDATION
// =============================================================================

function nonNegativeInt(v: unknown, field: string): number {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw new DevReportError(400, `${field} must be a whole number of 0 or more.`);
  }
  return n;
}

/** null/'' → null; otherwise a non-negative number (integer when `int`). */
function optionalNumber(v: unknown, field: string, int: boolean): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || (int && !Number.isInteger(n))) {
    throw new DevReportError(400, `${field} must be ${int ? 'a whole number' : 'a number'} of 0 or more.`);
  }
  return n;
}

function cleanToolName(v: unknown): string {
  const name = typeof v === 'string' ? v.trim() : '';
  if (!name) throw new DevReportError(400, 'A tool name is required.');
  if (name.length > MAX_TOOL_NAME) throw new DevReportError(400, `Tool names are limited to ${MAX_TOOL_NAME} characters.`);
  return name;
}

/** Normalizes the editable fields present in `input` (absent fields stay absent). */
function cleanToolInput(input: DevToolInput): {
  name?: string;
  description?: string | null;
  status?: DevToolStatus;
  launchedOn?: string | null;
  minutesSavedPerUse?: number | null;
  usersReached?: number | null;
} {
  const out: ReturnType<typeof cleanToolInput> = {};
  if (input.name !== undefined) out.name = cleanToolName(input.name);
  if (input.description !== undefined) {
    const d = typeof input.description === 'string' ? input.description.trim() : '';
    out.description = d || null;
  }
  if (input.status !== undefined) {
    if (!DEV_TOOL_STATUSES.includes(input.status)) throw new DevReportError(400, 'Status must be live, beta or retired.');
    out.status = input.status;
  }
  if (input.launchedOn !== undefined) {
    if (input.launchedOn === null || input.launchedOn === '') out.launchedOn = null;
    else {
      const iso = typeof input.launchedOn === 'string' ? parseUsageDate(input.launchedOn) : null;
      if (!iso) throw new DevReportError(400, 'Launch date must be a valid date.');
      out.launchedOn = iso;
    }
  }
  if (input.minutesSavedPerUse !== undefined) out.minutesSavedPerUse = optionalNumber(input.minutesSavedPerUse, 'Minutes saved per use', false);
  if (input.usersReached !== undefined) out.usersReached = optionalNumber(input.usersReached, 'Users reached', true);
  return out;
}

// =============================================================================
// READS
// =============================================================================

type ToolRow = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  launched_on: string | null;
  minutes_saved_per_use: number | null;
  users_reached: number | null;
  sort_order: number;
};

const TOOL_COLUMNS = 'id, name, description, status, launched_on, minutes_saved_per_use, users_reached, sort_order';

function toTool(r: ToolRow, usesYtd: number): DevTool {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    status: (DEV_TOOL_STATUSES as string[]).includes(r.status) ? (r.status as DevToolStatus) : 'live',
    launchedOn: r.launched_on ?? null,
    minutesSavedPerUse: r.minutes_saved_per_use == null ? null : Number(r.minutes_saved_per_use),
    usersReached: r.users_reached == null ? null : Number(r.users_reached),
    sortOrder: Number(r.sort_order),
    usesYtd,
  };
}

/** YTD uses per tool, keyed by lowercased name (usage is matched case-insensitively). */
async function ytdUsesByTool(start: string, end: string): Promise<Map<string, { name: string; uses: number }>> {
  const rows = await query<{ tool_name: string; uses: number }>(
    `SELECT tool_name, SUM(count) AS uses FROM dev_tool_usage WHERE day BETWEEN ? AND ? GROUP BY tool_name`,
    [start, end]
  );
  return new Map(rows.map(r => [r.tool_name.toLowerCase(), { name: r.tool_name, uses: Number(r.uses) }]));
}

async function listTools(): Promise<DevTool[]> {
  const { start, end } = ytdWindow();
  const [rows, uses] = await Promise.all([
    query<ToolRow>(`SELECT ${TOOL_COLUMNS} FROM dev_tools ORDER BY sort_order, name COLLATE NOCASE`),
    ytdUsesByTool(start, end),
  ]);
  return rows.map(r => toTool(r, uses.get(r.name.toLowerCase())?.uses ?? 0));
}

export async function getDevReportInputs(): Promise<DevReportInputs> {
  const { year } = ytdWindow();
  if (!hasDb()) return { year, months: [], tools: [], usage: { rows: 0, totalUses: 0, firstDay: null, lastDay: null, toolCount: 0 } };
  await ensureSchema();

  const [months, tools, coverage] = await Promise.all([
    query<{ month: string; commits: number; lines_added: number; lines_deleted: number }>(
      `SELECT month, commits, lines_added, lines_deleted FROM dev_code_months WHERE month LIKE ? ORDER BY month`,
      [`${year}-%`]
    ),
    listTools(),
    query<{ n: number; total: number | null; first: string | null; last: string | null; tools: number }>(
      `SELECT COUNT(*) AS n, SUM(count) AS total, MIN(day) AS first, MAX(day) AS last,
              COUNT(DISTINCT tool_name) AS tools
         FROM dev_tool_usage`
    ),
  ]);
  const c = coverage[0];
  return {
    year,
    months: months.map(m => ({
      month: m.month,
      commits: Number(m.commits),
      linesAdded: Number(m.lines_added),
      linesDeleted: Number(m.lines_deleted),
    })),
    tools,
    usage: {
      rows: Number(c?.n ?? 0),
      totalUses: Number(c?.total ?? 0),
      firstDay: c?.first ?? null,
      lastDay: c?.last ?? null,
      toolCount: Number(c?.tools ?? 0),
    },
  };
}

// =============================================================================
// WRITES
// =============================================================================

/**
 * Replaces this year's monthly code stats with `months`. Months outside the current
 * year (or in the future) are rejected; all-zero months are simply not stored.
 */
export async function saveCodeMonths(input: unknown): Promise<DevCodeMonth[]> {
  await ensureSchema();
  if (!Array.isArray(input)) throw new DevReportError(400, 'Expected a list of months.');
  const { year, currentMonth } = ytdWindow();

  const seen = new Set<string>();
  const months: DevCodeMonth[] = input.map((raw: Record<string, unknown>) => {
    const month = typeof raw?.month === 'string' ? raw.month : '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !month.startsWith(`${year}-`) || month > currentMonth) {
      throw new DevReportError(400, `"${month}" isn't a month of ${year} so far.`);
    }
    if (seen.has(month)) throw new DevReportError(400, `${month} appears twice.`);
    seen.add(month);
    return {
      month,
      commits: nonNegativeInt(raw.commits, 'Commits'),
      linesAdded: nonNegativeInt(raw.linesAdded, 'Lines added'),
      linesDeleted: nonNegativeInt(raw.linesDeleted, 'Lines deleted'),
    };
  });

  const stored = months.filter(m => m.commits || m.linesAdded || m.linesDeleted);
  await executeTransaction(tx => {
    tx.run(`DELETE FROM dev_code_months WHERE month LIKE ?`, [`${year}-%`]);
    for (const m of stored) {
      tx.run(
        `INSERT INTO dev_code_months (month, commits, lines_added, lines_deleted) VALUES (?, ?, ?, ?)`,
        [m.month, m.commits, m.linesAdded, m.linesDeleted]
      );
    }
  });
  return stored.sort((a, b) => a.month.localeCompare(b.month));
}

export async function createDevTool(input: DevToolInput): Promise<DevTool> {
  await ensureSchema();
  const clean = cleanToolInput({ ...input, name: input.name ?? '' });
  const name = clean.name!;
  const id = randomUUID();
  await executeTransaction(tx => {
    if (tx.get(`SELECT 1 FROM dev_tools WHERE name = ? COLLATE NOCASE`, [name])) {
      throw new DevReportError(409, `A tool named "${name}" already exists.`);
    }
    const max = tx.get<{ m: number }>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM dev_tools`)?.m ?? 0;
    tx.run(
      `INSERT INTO dev_tools (id, name, description, status, launched_on, minutes_saved_per_use, users_reached, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        clean.description ?? null,
        clean.status ?? 'live',
        clean.launchedOn ?? null,
        clean.minutesSavedPerUse ?? null,
        clean.usersReached ?? null,
        Number(max) + 1,
      ]
    );
  });
  return (await listTools()).find(t => t.id === id)!;
}

/** Updates a tool; a rename cascades into its usage rows. */
export async function updateDevTool(id: string, input: DevToolInput): Promise<DevTool> {
  await ensureSchema();
  const clean = cleanToolInput(input);
  await executeTransaction(tx => {
    const current = tx.get<ToolRow>(`SELECT ${TOOL_COLUMNS} FROM dev_tools WHERE id = ?`, [id]);
    if (!current) throw new DevReportError(404, 'That tool no longer exists.');
    const name = clean.name ?? current.name;
    if (name !== current.name) {
      if (tx.get(`SELECT 1 FROM dev_tools WHERE name = ? COLLATE NOCASE AND id != ?`, [name, id])) {
        throw new DevReportError(409, `A tool named "${name}" already exists.`);
      }
      tx.run(`UPDATE dev_tool_usage SET tool_name = ? WHERE tool_name = ?`, [name, current.name]);
    }
    tx.run(
      `UPDATE dev_tools
          SET name = ?, description = ?, status = ?, launched_on = ?, minutes_saved_per_use = ?, users_reached = ?
        WHERE id = ?`,
      [
        name,
        clean.description !== undefined ? clean.description : current.description,
        clean.status ?? current.status,
        clean.launchedOn !== undefined ? clean.launchedOn : current.launched_on,
        clean.minutesSavedPerUse !== undefined ? clean.minutesSavedPerUse : current.minutes_saved_per_use,
        clean.usersReached !== undefined ? clean.usersReached : current.users_reached,
        id,
      ]
    );
  });
  return (await listTools()).find(t => t.id === id)!;
}

/** Deletes a tool together with all of its usage rows. */
export async function deleteDevTool(id: string): Promise<void> {
  await ensureSchema();
  await executeTransaction(tx => {
    const current = tx.get<{ name: string }>(`SELECT name FROM dev_tools WHERE id = ?`, [id]);
    if (!current) throw new DevReportError(404, 'That tool no longer exists.');
    tx.run(`DELETE FROM dev_tool_usage WHERE tool_name = ?`, [current.name]);
    tx.run(`DELETE FROM dev_tools WHERE id = ?`, [id]);
  });
}

/**
 * Upserts pasted usage rows (re-pasting the same table is harmless: a day/tool pair
 * takes the newest count). Tools the inventory doesn't know yet are created as 'live'.
 */
export async function importUsage(input: unknown): Promise<{ imported: number; createdTools: string[] }> {
  await ensureSchema();
  if (!Array.isArray(input) || input.length === 0) throw new DevReportError(400, 'There are no rows to import.');
  if (input.length > MAX_USAGE_ROWS) throw new DevReportError(400, `Import at most ${MAX_USAGE_ROWS.toLocaleString()} rows at a time.`);

  const rows: UsageRow[] = input.map((raw: Record<string, unknown>, i) => {
    const day = typeof raw?.day === 'string' ? parseUsageDate(raw.day) : null;
    if (!day) throw new DevReportError(400, `Row ${i + 1}: invalid date.`);
    let tool: string;
    try {
      tool = cleanToolName(raw.tool);
    } catch (err) {
      throw new DevReportError(400, `Row ${i + 1}: ${(err as Error).message}`);
    }
    return { day, tool, count: nonNegativeInt(raw.count, `Row ${i + 1} count`) };
  });

  return executeTransaction(tx => {
    const known = new Set(tx.all<{ name: string }>(`SELECT name FROM dev_tools`).map(r => r.name.toLowerCase()));
    let order = Number(tx.get<{ m: number }>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM dev_tools`)?.m ?? 0);
    const createdTools: string[] = [];
    for (const r of rows) {
      const key = r.tool.toLowerCase();
      if (!known.has(key)) {
        known.add(key);
        createdTools.push(r.tool);
        tx.run(`INSERT INTO dev_tools (id, name, status, sort_order) VALUES (?, ?, 'live', ?)`, [randomUUID(), r.tool, ++order]);
      }
      tx.run(
        `INSERT INTO dev_tool_usage (day, tool_name, count) VALUES (?, ?, ?)
         ON CONFLICT (day, tool_name) DO UPDATE SET count = excluded.count`,
        [r.day, r.tool, r.count]
      );
    }
    return { imported: rows.length, createdTools };
  });
}

export async function clearUsage(): Promise<void> {
  await ensureSchema();
  await executeTransaction(tx => {
    tx.run(`DELETE FROM dev_tool_usage`);
  });
}

// =============================================================================
// REPORT
// =============================================================================

const DAY_MS = 86_400_000;
const isoToUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const utcToIso = (t: number) => new Date(t).toISOString().slice(0, 10);
const shortDate = (iso: string) => `${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;

/** The Monday on or before `iso`. */
function weekStart(iso: string): string {
  const t = isoToUTC(iso);
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  return utcToIso(t - ((dow + 6) % 7) * DAY_MS);
}

/** Weekdays (Mon–Fri) from `start` through `end`, inclusive. Holidays aren't excluded. */
function weekdaysBetween(start: string, end: string): number {
  let n = 0;
  for (let t = isoToUTC(start); t <= isoToUTC(end); t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** YYYY-MM one month after `ym`. */
function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function prevMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function emptyReport(): DevReportData {
  const { year, start, end } = ytdWindow();
  return {
    year,
    range: { start, end },
    generatedAt: new Date().toISOString(),
    code: { commits: 0, added: 0, deleted: 0, net: 0, monthsEntered: 0, months: [] },
    usage: { total: 0, firstDay: null, lastDay: null, avgPerDay: 0, busiestDay: null, weekly: [], byTool: [], growth: null },
    impact: { hoursSaved: 0, hoursPerWorkday: 0, byTool: [], toolsMissingEstimate: [] },
    tools: { live: 0, beta: 0, retired: 0, largestAudience: null, list: [] },
  };
}

export async function computeDevReport(): Promise<DevReportData> {
  if (!hasDb()) return emptyReport();
  await ensureSchema();
  const { year, start, end, currentMonth } = ytdWindow();

  const [monthRows, dayRows, toolRows, uses] = await Promise.all([
    query<{ month: string; commits: number; lines_added: number; lines_deleted: number }>(
      `SELECT month, commits, lines_added, lines_deleted FROM dev_code_months WHERE month BETWEEN ? AND ?`,
      [`${year}-01`, currentMonth]
    ),
    query<{ day: string; total: number }>(
      `SELECT day, SUM(count) AS total FROM dev_tool_usage WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`,
      [start, end]
    ),
    query<ToolRow>(`SELECT ${TOOL_COLUMNS} FROM dev_tools ORDER BY sort_order, name COLLATE NOCASE`),
    ytdUsesByTool(start, end),
  ]);

  // ---- Code: Jan → current month, zero-filled.
  const byMonth = new Map(monthRows.map(r => [r.month, r]));
  const months: DevReportData['code']['months'] = [];
  for (let ym = `${year}-01`; ym <= currentMonth; ym = nextMonth(ym)) {
    const r = byMonth.get(ym);
    months.push({
      month: ym,
      label: MONTH_ABBR[Number(ym.slice(5, 7)) - 1],
      commits: Number(r?.commits ?? 0),
      added: Number(r?.lines_added ?? 0),
      deleted: Number(r?.lines_deleted ?? 0),
    });
  }
  const sum = (k: 'commits' | 'added' | 'deleted') => months.reduce((s, m) => s + m[k], 0);
  const code = {
    commits: sum('commits'),
    added: sum('added'),
    deleted: sum('deleted'),
    net: sum('added') - sum('deleted'),
    monthsEntered: monthRows.length,
    months,
  };

  // ---- Tools (inventory order drives colors).
  const tools = toolRows.map((r, i) => ({
    ...toTool(r, uses.get(r.name.toLowerCase())?.uses ?? 0),
    color: DEV_TOOL_PALETTE[i % DEV_TOOL_PALETTE.length],
  }));
  const colorOf = new Map(tools.map(t => [t.name.toLowerCase(), t.color]));
  const minutesOf = new Map(tools.map(t => [t.name.toLowerCase(), t.minutesSavedPerUse]));

  // ---- Usage.
  const total = dayRows.reduce((s, r) => s + Number(r.total), 0);
  const firstDay = dayRows[0]?.day ?? null;
  const lastDay = dayRows.at(-1)?.day ?? null;
  const trackedDays = firstDay && lastDay ? Math.round((isoToUTC(lastDay) - isoToUTC(firstDay)) / DAY_MS) + 1 : 0;
  const busiest = dayRows.reduce<{ day: string; count: number } | null>(
    (best, r) => (!best || Number(r.total) > best.count ? { day: r.day, count: Number(r.total) } : best),
    null
  );

  const weekly: DevReportData['usage']['weekly'] = [];
  const monthlyUses = new Map<string, number>();
  if (firstDay) {
    const byWeek = new Map<string, number>();
    for (const r of dayRows) {
      const wk = weekStart(r.day);
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + Number(r.total));
      const ym = r.day.slice(0, 7);
      monthlyUses.set(ym, (monthlyUses.get(ym) ?? 0) + Number(r.total));
    }
    const lastWeek = weekStart(end);
    for (let wk = weekStart(firstDay); wk <= lastWeek; wk = utcToIso(isoToUTC(wk) + 7 * DAY_MS)) {
      weekly.push({ weekStart: wk, label: shortDate(wk), value: byWeek.get(wk) ?? 0 });
    }
  }

  // Growth: the latest full month vs the first full tracked month.
  let growth: DevReportData['usage']['growth'] = null;
  if (firstDay) {
    const firstFull = firstDay.endsWith('-01') ? firstDay.slice(0, 7) : nextMonth(firstDay.slice(0, 7));
    const lastFull = prevMonth(currentMonth);
    const from = monthlyUses.get(firstFull) ?? 0;
    if (firstFull < lastFull && from > 0) {
      const to = monthlyUses.get(lastFull) ?? 0;
      growth = {
        fromLabel: MONTH_ABBR[Number(firstFull.slice(5, 7)) - 1],
        toLabel: MONTH_ABBR[Number(lastFull.slice(5, 7)) - 1],
        pct: ((to - from) / from) * 100,
      };
    }
  }

  const usedTools = [...uses.values()].filter(u => u.uses > 0);
  const byTool = usedTools
    .map(u => ({ name: u.name, uses: u.uses, color: colorOf.get(u.name.toLowerCase()) ?? '#71717a' }))
    .sort((a, b) => b.uses - a.uses);

  // ---- Impact: hours saved = uses × minutes per use.
  const impactByTool = usedTools
    .filter(u => (minutesOf.get(u.name.toLowerCase()) ?? 0) > 0)
    .map(u => ({
      name: u.name,
      hours: (u.uses * (minutesOf.get(u.name.toLowerCase()) ?? 0)) / 60,
      minutesPerUse: minutesOf.get(u.name.toLowerCase()) ?? 0,
      color: colorOf.get(u.name.toLowerCase()) ?? '#71717a',
    }))
    .sort((a, b) => b.hours - a.hours);
  const hoursSaved = impactByTool.reduce((s, t) => s + t.hours, 0);
  const workdays = firstDay && lastDay ? weekdaysBetween(firstDay, lastDay) : 0;

  const audience = tools
    .filter(t => (t.usersReached ?? 0) > 0)
    .reduce<{ name: string; users: number } | null>(
      (best, t) => (!best || t.usersReached! > best.users ? { name: t.name, users: t.usersReached! } : best),
      null
    );

  return {
    year,
    range: { start, end },
    generatedAt: new Date().toISOString(),
    code,
    usage: {
      total,
      firstDay,
      lastDay,
      avgPerDay: trackedDays ? total / trackedDays : 0,
      busiestDay: busiest,
      weekly,
      byTool,
      growth,
    },
    impact: {
      hoursSaved,
      hoursPerWorkday: workdays ? hoursSaved / workdays : 0,
      byTool: impactByTool,
      toolsMissingEstimate: usedTools.filter(u => !((minutesOf.get(u.name.toLowerCase()) ?? 0) > 0)).map(u => u.name),
    },
    tools: {
      live: tools.filter(t => t.status === 'live').length,
      beta: tools.filter(t => t.status === 'beta').length,
      retired: tools.filter(t => t.status === 'retired').length,
      largestAudience: audience,
      list: tools.map(t => ({
        name: t.name,
        status: t.status,
        launchedOn: t.launchedOn,
        usersReached: t.usersReached,
        uses: t.usesYtd,
        color: t.color,
      })),
    },
  };
}
