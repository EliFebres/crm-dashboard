/**
 * Data for the downloadable Team KPIs PDF report ("year in review").
 *
 * Unlike the dashboard functions in kpi-aggregations.ts, a report can cover one
 * person: `subject.member` narrows every query to engagements whose team_members
 * array contains that display name. Who may ask for which subject is decided in
 * /api/kpi/report, not here.
 *
 * Period handling matches the dashboard: the current window comes from
 * buildKpiWhere (date_started inside the period) and the comparison window from
 * getPreviousPeriodDates, so a team report's headline numbers equal the page's.
 */
import { query } from './index';
import { hasDb } from './connection';
import { departmentColorMap } from './departments';
import { projectTypeColorMap } from './projectTypes';
import type { ServerConstraints } from './queries';
import { getPeriodStartISO, getPreviousPeriodDates, localTodayISO } from './dateUtils';
import { SQL_COMPLETED, SQL_OPEN } from '../statusHelpers';
import { buildKpiWhere, deltaPercent, pct, quantile, type SqlClause } from './kpi-aggregations';
import type { KpiFilters, KpiReportData, KpiReportStat, KpiReportBreakdownRow } from '../api/kpi';

export interface ReportSubject {
  kind: KpiReportData['subject']['kind'];
  name: string;
  title?: string;
  team?: string;
  /** Display name to filter team_members by. Set for person reports only. */
  member?: string;
}

const FALLBACK_COLOR = '#71717a';

/** Append an extra condition to a (possibly empty) WHERE clause. */
function andWhere(base: string, condition: string): string {
  return base ? `${base} AND ${condition}` : `WHERE ${condition}`;
}

function stat(value: number, prev: number): KpiReportStat {
  return { value, prev, deltaPercent: deltaPercent(value, prev) };
}

interface Totals {
  interactions: number;
  inProgress: number;
  completed: number;
  nna: number;
  clients: number;
}

async function totalsFor({ whereClause, params }: SqlClause): Promise<Totals> {
  const rows = await query<Record<string, unknown>>(
    `
      SELECT
        COUNT(*)                                  AS interactions,
        COUNT(*) FILTER (WHERE ${SQL_OPEN})       AS in_progress,
        COUNT(*) FILTER (WHERE ${SQL_COMPLETED})  AS completed,
        COALESCE(SUM(nna), 0)                     AS total_nna,
        COUNT(DISTINCT internal_client_name)      AS clients
      FROM engagements
      ${whereClause}
    `,
    params
  );
  const r = rows[0] ?? {};
  return {
    interactions: Number(r.interactions ?? 0),
    inProgress: Number(r.in_progress ?? 0),
    completed: Number(r.completed ?? 0),
    nna: Number(r.total_nna ?? 0),
    clients: Number(r.clients ?? 0),
  };
}

// ---------- time buckets ----------

type Granularity = KpiReportData['series']['granularity'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

/** Days since the epoch for an ISO "YYYY-MM-DD" date, in UTC so DST never shifts a bucket. */
function dayNumber(iso: string): number {
  return Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS);
}

function monthNumber(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}

/** Day number of the Monday on or before `day` (1970-01-01 was a Thursday). */
function mondayOf(day: number): number {
  return day - ((day + 3) % 7);
}

function pickGranularity(period: string, start: string, end: string): Granularity {
  if (period === '1M' || period === '3M') return 'week';
  if (monthNumber(end) - monthNumber(start) > 36) return 'year';
  return 'month';
}

function bucketKey(iso: string, g: Granularity): number {
  if (g === 'week') return mondayOf(dayNumber(iso));
  if (g === 'month') return monthNumber(iso);
  return Number(iso.slice(0, 4));
}

function bucketLabel(key: number, g: Granularity, isFirst: boolean): string {
  if (g === 'year') return String(key);
  if (g === 'week') {
    const d = new Date(key * DAY_MS);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  const month = key % 12;
  const year = Math.floor(key / 12);
  return month === 0 || isFirst ? `${MONTHS[month]} '${String(year).slice(2)}` : MONTHS[month];
}

function buildSeries(
  rows: Record<string, unknown>[],
  start: string,
  end: string,
  g: Granularity
): KpiReportData['series'] {
  const first = bucketKey(start, g);
  const last = bucketKey(end, g);
  const step = g === 'week' ? 7 : 1;
  const counts = new Map<number, { opened: number; completed: number }>();
  for (let k = first; k <= last; k += step) counts.set(k, { opened: 0, completed: 0 });

  for (const r of rows) {
    const started = r.date_started ? String(r.date_started).slice(0, 10) : '';
    const finished = r.date_finished ? String(r.date_finished).slice(0, 10) : '';
    if (started >= start && started <= end) {
      const b = counts.get(bucketKey(started, g));
      if (b) b.opened++;
    }
    if (finished >= start && finished <= end) {
      const b = counts.get(bucketKey(finished, g));
      if (b) b.completed++;
    }
  }

  return {
    granularity: g,
    points: [...counts.entries()].map(([k, v], i) => ({ label: bucketLabel(k, g, i === 0), ...v })),
  };
}

// ---------- report ----------

/**
 * Share of the previous period the subject's history must span before the report
 * shows "vs previous period" changes. Below it, the previous period is (mostly) empty
 * because the data or the person didn't exist yet, and every change would read as a
 * drop from nothing. Slightly under 1 so history starting a few days late still counts.
 */
const MIN_PREVIOUS_COVERAGE = 0.9;

function coversPreviousPeriod(first: string | null, prev: { start: string; end: string }): boolean {
  if (!first) return false;
  const prevStart = dayNumber(prev.start);
  const prevEnd = dayNumber(prev.end);
  const covered = prevEnd - Math.max(prevStart, dayNumber(first)) + 1;
  return covered / (prevEnd - prevStart + 1) >= MIN_PREVIOUS_COVERAGE;
}

function emptyReport(filters: KpiFilters, subject: ReportSubject): KpiReportData {
  const today = localTodayISO();
  const zero = stat(0, 0);
  return {
    subject: { kind: subject.kind, name: subject.name, title: subject.title, team: subject.team },
    period: filters.period,
    range: { start: getPeriodStartISO(filters.period) ?? today, end: today },
    hasComparison: false,
    comparisonLabel: getPreviousPeriodDates(filters.period).label,
    generatedAt: new Date().toISOString(),
    totals: {
      interactions: zero,
      completed: zero,
      nna: zero,
      avgNna: zero,
      completionRate: zero,
      clientsServed: zero,
      newClients: 0,
      inProgress: 0,
    },
    series: { granularity: 'month', points: [] },
    byDept: [],
    byType: [],
    topWins: [],
    topClients: [],
    cycle: { overallMedian: null, finishedCount: 0, byType: [] },
  };
}

export async function computeReport(
  filters: KpiFilters,
  constraints: ServerConstraints,
  subject: ReportSubject
): Promise<KpiReportData> {
  if (!hasDb()) return emptyReport(filters, subject);

  const member = subject.member;
  const prevDates = getPreviousPeriodDates(filters.period);
  const today = localTodayISO();

  // `base` has every filter except the period; `curr` adds the period window.
  const base = buildKpiWhere(filters, constraints, { includePeriod: false, member });
  const curr = buildKpiWhere(filters, constraints, { member });
  const prev: SqlClause = {
    whereClause: andWhere(base.whereClause, 'date_started >= ? AND date_started <= ?'),
    params: [...base.params, prevDates.start, prevDates.end],
  };

  // The subject's first-ever engagement: where an ALL report begins, and how much of
  // the previous period their history actually covers.
  const firstRows = await query<{ first: string | null }>(
    `SELECT MIN(date_started) AS first FROM engagements ${base.whereClause}`,
    base.params
  );
  const first = firstRows[0]?.first ? String(firstRows[0].first).slice(0, 10) : null;

  const start = getPeriodStartISO(filters.period) ?? first ?? today;
  const end = today;
  const hasComparison = filters.period !== 'ALL' && coversPreviousPeriod(first, prevDates);

  const finishedInPeriod: SqlClause = {
    whereClause: andWhere(base.whereClause, 'date_finished IS NOT NULL AND date_finished >= ?'),
    params: [...base.params, start],
  };

  const [
    currTotals,
    prevTotals,
    newClientRows,
    seriesRows,
    deptRows,
    typeRows,
    winRows,
    clientRows,
    cycleRows,
    deptColors,
    typeColors,
  ] = await Promise.all([
    totalsFor(curr),
    hasComparison ? totalsFor(prev) : Promise.resolve(null),
    // A client is "new" when its first-ever engagement (for this subject) falls inside the period.
    query<{ n: number }>(
      `
        SELECT COUNT(*) AS n FROM (
          SELECT MIN(date_started) AS first
          FROM engagements
          ${base.whereClause}
          GROUP BY internal_client_name
        ) WHERE first >= ?
      `,
      [...base.params, start]
    ),
    query<Record<string, unknown>>(
      `
        SELECT date_started, date_finished
        FROM engagements
        ${andWhere(base.whereClause, '(date_started >= ? OR date_finished >= ?)')}
      `,
      [...base.params, start, start]
    ),
    query<Record<string, unknown>>(
      `
        SELECT internal_client_dept AS name, COUNT(*) AS n, COALESCE(SUM(nna), 0) AS nna
        FROM engagements
        ${curr.whereClause}
        GROUP BY internal_client_dept
        ORDER BY n DESC
      `,
      curr.params
    ),
    query<Record<string, unknown>>(
      `
        SELECT type AS name, COUNT(*) AS n, COALESCE(SUM(nna), 0) AS nna
        FROM engagements
        ${curr.whereClause}
        GROUP BY type
        ORDER BY n DESC
      `,
      curr.params
    ),
    query<Record<string, unknown>>(
      `
        SELECT e.internal_client_name AS client, e.internal_client_dept AS dept, e.type,
               e.date_finished, e.nna, c.name AS external
        FROM engagements e
        LEFT JOIN clients c ON c.crn = e.client_crn
        ${andWhere(buildKpiWhere(filters, constraints, { member, tableAlias: 'e' }).whereClause, `e.nna > 0 AND e.${SQL_COMPLETED}`)}
        ORDER BY e.nna DESC
        LIMIT 5
      `,
      curr.params
    ),
    query<Record<string, unknown>>(
      `
        SELECT internal_client_name AS client, internal_client_dept AS dept, SUM(nna) AS nna
        FROM engagements
        ${andWhere(curr.whereClause, 'nna > 0')}
        GROUP BY internal_client_name, internal_client_dept
        ORDER BY nna DESC
        LIMIT 5
      `,
      curr.params
    ),
    query<Record<string, unknown>>(
      `
        SELECT type, julianday(date_finished) - julianday(date_started) AS days
        FROM engagements
        ${finishedInPeriod.whereClause}
      `,
      finishedInPeriod.params
    ),
    departmentColorMap(),
    projectTypeColorMap(),
  ]);

  const p = prevTotals ?? { interactions: 0, inProgress: 0, completed: 0, nna: 0, clients: 0 };
  const c = currTotals;
  const avg = (t: Totals) => (t.interactions > 0 ? t.nna / t.interactions : 0);

  const breakdown = (rows: Record<string, unknown>[], colors: Record<string, string>): KpiReportBreakdownRow[] =>
    rows.map(r => ({
      name: String(r.name ?? ''),
      count: Number(r.n ?? 0),
      nna: Number(r.nna ?? 0),
      color: colors[String(r.name ?? '')] || FALLBACK_COLOR,
    }));

  // Cycle time: completed work finished inside the period, in whole days.
  const allDays: number[] = [];
  const daysByType = new Map<string, number[]>();
  for (const r of cycleRows) {
    const days = Math.max(0, Number(r.days ?? 0));
    const type = String(r.type ?? '');
    allDays.push(days);
    if (!type) continue;
    const arr = daysByType.get(type) ?? [];
    arr.push(days);
    daysByType.set(type, arr);
  }
  allDays.sort((a, b) => a - b);
  const cycleByType = [...daysByType.entries()]
    .map(([type, arr]) => {
      arr.sort((a, b) => a - b);
      return { type, median: quantile(arr, 0.5), count: arr.length, color: typeColors[type] || FALLBACK_COLOR };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return {
    subject: { kind: subject.kind, name: subject.name, title: subject.title, team: subject.team },
    period: filters.period,
    range: { start, end },
    hasComparison,
    comparisonLabel: prevDates.label,
    generatedAt: new Date().toISOString(),
    totals: {
      interactions: stat(c.interactions, p.interactions),
      completed: stat(c.completed, p.completed),
      nna: stat(c.nna, p.nna),
      avgNna: stat(avg(c), avg(p)),
      completionRate: stat(pct(c.completed, c.interactions), pct(p.completed, p.interactions)),
      clientsServed: stat(c.clients, p.clients),
      newClients: Number(newClientRows[0]?.n ?? 0),
      inProgress: c.inProgress,
    },
    series: buildSeries(seriesRows, start, end, pickGranularity(filters.period, start, end)),
    byDept: breakdown(deptRows, deptColors),
    byType: breakdown(typeRows, typeColors),
    topWins: winRows.map(r => ({
      clientName: String(r.client ?? ''),
      clientDept: String(r.dept ?? ''),
      externalClient: r.external ? String(r.external) : null,
      type: String(r.type ?? ''),
      dateFinished: r.date_finished ? String(r.date_finished).slice(0, 10) : null,
      nna: Number(r.nna ?? 0),
    })),
    topClients: clientRows.map(r => ({
      clientName: String(r.client ?? ''),
      clientDept: String(r.dept ?? ''),
      nna: Number(r.nna ?? 0),
      share: pct(Number(r.nna ?? 0), c.nna),
    })),
    cycle: {
      overallMedian: allDays.length ? quantile(allDays, 0.5) : null,
      finishedCount: allDays.length,
      byType: cycleByType,
    },
  };
}
