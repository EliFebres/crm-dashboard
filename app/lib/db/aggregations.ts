/**
 * Server-side aggregation functions for the Client Interactions dashboard.
 *
 * DATA SOURCE:
 * - If SQLITE_DIR env var is set → query SQLite (real data)
 * - If SQLITE_DIR is not set    → return mock data (development/demo)
 */
import { query } from './index';
import { hasDb } from './connection';
import {
  getMockMetrics,
  getMockDepartmentBreakdown,
  getMockContributionData,
  getMockEngagementsList,
} from '../api/mock-computations';
import { buildFilterClause, resolveOfficeMembers, rowToEngagement, SORT_COLUMN_MAP, CLIENT_JOIN } from './queries';
import type { ServerConstraints } from './queries';
import { listDepartmentNames, departmentColorMap } from './departments';
import { listIntakeTypeNames, intakeNameForRole } from './intakeTypes';
import { listProjectTypeNames, projectNameForRole } from './projectTypes';
import { getPreviousPeriodDates, getPeriodStartISO } from './dateUtils';
import type { EngagementFilters, DashboardMetrics, DepartmentBreakdown, ContributionDataResponse, EngagementsResponse, FilterOptions } from '../api/client-interactions';
import type { DayData } from '../types/engagements';
import { VALID_STATUSES } from '../statusHelpers';

// Static filter options — these don't change dynamically in this application.
// NOTE: `departments` is a fallback default only; the live list is fetched from the
// `departments` table via getDepartmentNames() (see the dashboard route).
export const STATIC_FILTER_OPTIONS: FilterOptions = {
  teamMembers: ['All Team Members', 'Office B', 'Office A'],
  teamMemberGroups: [
    { label: 'Office', options: ['Office B', 'Office A'] },
  ],
  departments: ['Brokerage', 'Advisory', 'Institutional', 'Retirement'],
  intakeTypes: ['IRQ', 'SERF', 'Ad-Hoc'],
  projectTypes: ['Data Request', 'Data Update', 'Discovery Meeting', 'Follow-up Material', 'Follow-up Meeting', 'Meeting', 'Other', 'PCR'],
  statuses: [...VALID_STATUSES],
};

// Live department names for filter options. Falls back to the static list if the
// (real) DB read fails for any reason, so the dashboard filter never breaks.
export async function getDepartmentNames(): Promise<string[]> {
  try {
    const names = await listDepartmentNames();
    return names.length > 0 ? names : STATIC_FILTER_OPTIONS.departments;
  } catch {
    return STATIC_FILTER_OPTIONS.departments;
  }
}

// Live intake-type names for filter options (falls back to the static list).
export async function getIntakeTypeNames(): Promise<string[]> {
  try {
    const names = await listIntakeTypeNames();
    return names.length > 0 ? names : STATIC_FILTER_OPTIONS.intakeTypes;
  } catch {
    return STATIC_FILTER_OPTIONS.intakeTypes;
  }
}

// Live project-type names for filter options (falls back to the static list).
export async function getProjectTypeNames(): Promise<string[]> {
  try {
    const names = await listProjectTypeNames();
    return names.length > 0 ? names : STATIC_FILTER_OPTIONS.projectTypes;
  } catch {
    return STATIC_FILTER_OPTIONS.projectTypes;
  }
}

// Escapes a managed type name as a SQLite string literal. Metric SQL references
// built-in intake/project types by their CURRENT name (resolved from a stable role)
// so a rename never breaks a KPI; values are admin-managed and quote-escaped here.
function sqlLiteral(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

// =============================================================================
// METRICS
// =============================================================================

export async function computeMetrics(filters: EngagementFilters, serverConstraints: ServerConstraints = {}): Promise<DashboardMetrics> {
  if (!hasDb()) return getMockMetrics(filters);

  const resolved = await resolveOfficeMembers(filters);
  const period = resolved.period || '1Y';
  const prevDates = getPreviousPeriodDates(period);
  const { whereClause: currWhere, params: currParams } = buildFilterClause({ ...resolved, period }, 'e', serverConstraints);

  // ---- Build all WHERE clauses before firing queries in parallel ----

  // Previous period
  const prevFilters = { ...resolved, period: undefined };
  const { whereClause: baseWhere, params: baseParams } = buildFilterClause(prevFilters, 'e', serverConstraints);
  const prevAndClause = baseWhere
    ? `${baseWhere} AND date_started >= ? AND date_started <= ?`
    : `WHERE date_started >= ? AND date_started <= ?`;
  const prevParams = [...baseParams, prevDates.start, prevDates.end];

  // In-progress count + sparkline (share the same base filter)
  const inProgressFilters = { ...resolved, status: undefined };
  const { whereClause: ipWhere, params: ipParams } = buildFilterClause(inProgressFilters, 'e', serverConstraints);
  const sparklineAndClause = ipWhere
    ? `${ipWhere} AND date_started >= date('now', '-56 days')`
    : `WHERE date_started >= date('now', '-56 days')`;

  // Resolve built-in intake/project types by their stable role to their CURRENT
  // display name, so the metric SQL below keeps working after an admin rename.
  const [irqName, serfName, adHocName, pcrName] = await Promise.all([
    intakeNameForRole('irq'),
    intakeNameForRole('serf'),
    intakeNameForRole('ad_hoc'),
    projectNameForRole('pcr'),
  ]);
  const IRQ = sqlLiteral(irqName);
  const SERF = sqlLiteral(serfName);
  const ADHOC = sqlLiteral(adHocName);
  const PCR = sqlLiteral(pcrName);

  // ---- Fire all 4 queries in parallel — none depends on another's result ----
  const [projectRows, prevRows, inProgressRows, sparklineRows] = await Promise.all([
    // Current period: client projects (IRQ/SERF non-PCR) + Ad-Hoc
    query<Record<string, unknown>>(`
      SELECT
        COUNT(*) FILTER (WHERE intake_type IN (${IRQ}, ${SERF}) AND type != ${PCR})  AS project_count,
        COUNT(*) FILTER (WHERE intake_type = ${IRQ}  AND type != ${PCR})            AS irq_count,
        COUNT(*) FILTER (WHERE intake_type = ${SERF} AND type != ${PCR})            AS serf_count,
        COUNT(*) FILTER (WHERE intake_type IN (${IRQ}, ${SERF}) AND type != ${PCR})  AS eligible_count,
        COUNT(*) FILTER (WHERE intake_type IN (${IRQ}, ${SERF}) AND type != ${PCR}
                           AND portfolio_logged = TRUE)                            AS portfolios_logged,
        COUNT(*) FILTER (WHERE intake_type = ${ADHOC})                        AS adhoc_count,
        COUNT(*) FILTER (WHERE intake_type = ${ADHOC} AND ad_hoc_channel = 'In-Person') AS adhoc_in_person,
        COUNT(*) FILTER (WHERE intake_type = ${ADHOC} AND ad_hoc_channel = 'Email')     AS adhoc_email,
        COUNT(*) FILTER (WHERE intake_type = ${ADHOC} AND ad_hoc_channel = 'Teams')     AS adhoc_teams,
        COALESCE(SUM(nna), 0)                                                     AS total_nna,
        COUNT(*) FILTER (WHERE nna > 0)                                           AS nna_project_count,
        COUNT(*) FILTER (WHERE nna > 0 AND nna < 50000000)                        AS nna_tier1,
        COUNT(*) FILTER (WHERE nna > 0 AND nna >= 50000000  AND nna < 200000000)  AS nna_tier2,
        COUNT(*) FILTER (WHERE nna > 0 AND nna >= 200000000)                      AS nna_tier3
      FROM engagements e ${CLIENT_JOIN} ${currWhere}
    `, currParams),
    // Previous period: for change% calculations
    query<Record<string, unknown>>(`
      SELECT
        COUNT(*) FILTER (WHERE intake_type IN (${IRQ}, ${SERF}) AND type != ${PCR}) AS prev_projects,
        COUNT(*) FILTER (WHERE intake_type = ${ADHOC})                       AS prev_adhoc,
        COALESCE(SUM(nna), 0)                                                    AS prev_nna
      FROM engagements e ${CLIENT_JOIN} ${prevAndClause}
    `, prevParams),
    // In-progress: current count + last week's count (currently in-progress OR finished this week)
    query<Record<string, unknown>>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'In Progress') AS count,
        COUNT(*) FILTER (WHERE status = 'In Progress'
          OR (date_finished >= date('now', '-' || ((strftime('%w','now') + 6) % 7) || ' days') AND status != 'In Progress')
        ) AS last_week
      FROM engagements e ${CLIENT_JOIN} ${ipWhere || ''}
    `, ipParams),
    // Weekly in-progress sparkline (last 8 weeks, same filters)
    query<Record<string, unknown>>(`
      SELECT
        strftime('%Y-W%W', date_started) AS week_key,
        COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress_count
      FROM engagements e ${CLIENT_JOIN} ${sparklineAndClause}
      GROUP BY week_key
      ORDER BY week_key
    `, ipParams),
  ]);

  // -------------------------------------------------------------------------
  // Compute metrics from query results
  // -------------------------------------------------------------------------
  const p = projectRows[0];
  const prev = prevRows[0];
  const inProgressCount = Number(inProgressRows[0]?.count ?? 0);

  const projectCount = Number(p?.project_count ?? 0);
  const prevProjects = Number(prev?.prev_projects ?? 0);
  const projectChangePercent = prevProjects > 0
    ? Math.round(((projectCount - prevProjects) / prevProjects) * 100)
    : projectCount > 0 ? 100 : 0;

  const irqCount = Number(p?.irq_count ?? 0);
  const serfCount = Number(p?.serf_count ?? 0);
  const eligibleCount = Number(p?.eligible_count ?? 0);
  const portfoliosLogged = Number(p?.portfolios_logged ?? 0);
  const totalProjects = irqCount + serfCount;

  const adhocCount = Number(p?.adhoc_count ?? 0);
  const prevAdhoc = Number(prev?.prev_adhoc ?? 0);
  const adhocChangePercent = prevAdhoc > 0
    ? Math.round(((adhocCount - prevAdhoc) / prevAdhoc) * 100)
    : adhocCount > 0 ? 100 : 0;

  const adhocInPerson = Number(p?.adhoc_in_person ?? 0);
  const adhocEmail = Number(p?.adhoc_email ?? 0);
  const adhocTeams = Number(p?.adhoc_teams ?? 0);

  const totalNNA = Number(p?.total_nna ?? 0);
  const nnaProjectCount = Number(p?.nna_project_count ?? 0);
  const prevNNA = Number(prev?.prev_nna ?? 0);
  const nnaChangePercent = prevNNA > 0
    ? Math.round(((totalNNA - prevNNA) / prevNNA) * 100)
    : totalNNA > 0 ? 100 : 0;

  // Build sparkline: weekly in-progress start counts, gap-filled with 0
  const sparklineValues = sparklineRows.map(r => ({ value: Number(r.in_progress_count ?? 0) }));
  while (sparklineValues.length < 8) {
    sparklineValues.unshift({ value: 0 });
  }
  const lastWeekInProgress = Number(inProgressRows[0]?.last_week ?? 0);
  const inProgressChange = inProgressCount - lastWeekInProgress;

  const INTAKE_COLORS: Record<string, string> = {
    'In-Person': '#a5f3fc',
    'Email': '#22d3ee',
    'Teams': '#0e7490',
  };

  return {
    clientProjects: {
      count: projectCount,
      changePercent: projectChangePercent,
      periodLabel: prevDates.label,
      intakeSourceBreakdown: {
        irqCount,
        irqPercent: totalProjects > 0 ? Math.round((irqCount / totalProjects) * 100) : 0,
        serfCount,
        serfPercent: totalProjects > 0 ? Math.round((serfCount / totalProjects) * 100) : 0,
        portfoliosLogged,
        portfoliosTotal: eligibleCount,
        portfoliosPercent: eligibleCount > 0 ? Math.round((portfoliosLogged / eligibleCount) * 100) : 0,
      },
    },
    adHoc: {
      count: adhocCount,
      changePercent: adhocChangePercent,
      periodLabel: prevDates.label,
      intakeBreakdown: [
        { intake: 'In-Person', count: adhocInPerson, percent: adhocCount > 0 ? Math.round((adhocInPerson / adhocCount) * 100) : 0, color: INTAKE_COLORS['In-Person'] },
        { intake: 'Email', count: adhocEmail, percent: adhocCount > 0 ? Math.round((adhocEmail / adhocCount) * 100) : 0, color: INTAKE_COLORS['Email'] },
        { intake: 'Teams', count: adhocTeams, percent: adhocCount > 0 ? Math.round((adhocTeams / adhocCount) * 100) : 0, color: INTAKE_COLORS['Teams'] },
      ],
    },
    inProgress: {
      count: inProgressCount,
      change: inProgressChange,
      sparklineData: sparklineValues,
    },
    nna: {
      total: totalNNA,
      projectCount: nnaProjectCount,
      changePercent: nnaChangePercent,
      tiers: [
        { label: '<$50M', count: Number(p?.nna_tier1 ?? 0), color: '#0e7490' },
        { label: '$50-200M', count: Number(p?.nna_tier2 ?? 0), color: '#22d3ee' },
        { label: '$200M+', count: Number(p?.nna_tier3 ?? 0), color: '#39FF14' },
      ],
    },
  };
}

// =============================================================================
// DEPARTMENT BREAKDOWN
// =============================================================================

export async function computeDepartmentBreakdown(filters: EngagementFilters, serverConstraints: ServerConstraints = {}): Promise<DepartmentBreakdown> {
  if (!hasDb()) return getMockDepartmentBreakdown(filters);

  const resolved = await resolveOfficeMembers(filters);
  const { whereClause, params } = buildFilterClause(resolved, 'e', serverConstraints);

  const [rows, deptColors] = await Promise.all([
    query<Record<string, unknown>>(`
      SELECT internal_client_dept AS dept, COUNT(*) AS cnt
      FROM engagements e ${CLIENT_JOIN} ${whereClause}
      GROUP BY internal_client_dept
    `, params),
    departmentColorMap(),
  ]);

  const total = rows.reduce((s, r) => s + Number(r.cnt), 0);
  const safeTotal = total || 1;

  // Zero-fill every managed department (in their configured order) so each appears
  // even at count 0. Any department present in data but not managed is appended.
  const deptMap: Record<string, number> = {};
  Object.keys(deptColors).forEach(name => { deptMap[name] = 0; });
  rows.forEach(r => {
    const dept = r.dept as string;
    deptMap[dept] = Number(r.cnt);
  });

  return {
    departments: Object.entries(deptMap).map(([name, count]) => ({
      name,
      value: Math.round((count / safeTotal) * 100),
      count,
      color: deptColors[name] || '#71717a',
    })),
    total,
  };
}

// =============================================================================
// CONTRIBUTION (HEATMAP) DATA
// =============================================================================

export async function computeContributionData(filters: EngagementFilters, serverConstraints: ServerConstraints = {}): Promise<ContributionDataResponse> {
  if (!hasDb()) return getMockContributionData(filters);

  const resolved = await resolveOfficeMembers(filters);
  // Apply all filters EXCEPT period — heatmap always shows a rolling 104-week window
  const heatmapFilters = { ...resolved, period: undefined };
  const { whereClause, params } = buildFilterClause(heatmapFilters, 'e', serverConstraints);

  const heatmapStart = new Date();
  heatmapStart.setDate(heatmapStart.getDate() - 104 * 7);
  const heatmapStartISO = heatmapStart.toISOString().split('T')[0];

  const dateFilter = whereClause
    ? `${whereClause} AND date_finished IS NOT NULL AND date_finished >= ?`
    : `WHERE date_finished IS NOT NULL AND date_finished >= ?`;

  const ADHOC = sqlLiteral(await intakeNameForRole('ad_hoc'));
  const rows = await query<Record<string, unknown>>(`
    SELECT
      CAST(date_finished AS VARCHAR) AS finish_date,
      COUNT(*) FILTER (WHERE intake_type != ${ADHOC}) AS project_count,
      COUNT(*) FILTER (WHERE intake_type = ${ADHOC})  AS ad_hoc_count
    FROM engagements e ${CLIENT_JOIN} ${dateFilter}
    GROUP BY CAST(date_finished AS VARCHAR)
    ORDER BY finish_date
  `, [...params, heatmapStartISO]);

  // Build a lookup map from ISO date string to counts
  const completionsByDate = new Map<string, { projects: number; adHoc: number }>();
  for (const row of rows) {
    const dateStr = (row.finish_date as string).split('T')[0]; // strip any time component
    completionsByDate.set(dateStr, {
      projects: Number(row.project_count ?? 0),
      adHoc: Number(row.ad_hoc_count ?? 0),
    });
  }

  // Build 104-week weekday grid (same logic as existing generateContributionData)
  const startDate = new Date(heatmapStartISO + 'T00:00:00');
  // Align to nearest Monday on or after startDate
  const dayOfWeek = startDate.getDay(); // 0=Sun, 1=Mon...
  const mondayOffset = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 2 : 1 - dayOfWeek;
  const anchorMonday = new Date(startDate);
  anchorMonday.setDate(startDate.getDate() + mondayOffset);

  const weeks: DayData[][] = [];
  let maxCount = 0;
  let totalDays = 0;

  for (let week = 0; week < 105; week++) {
    const days: DayData[] = [];
    for (let day = 0; day < 5; day++) {
      const d = new Date(anchorMonday);
      d.setDate(anchorMonday.getDate() + week * 7 + day);
      const key = d.toISOString().split('T')[0];
      const completions = completionsByDate.get(key) ?? { projects: 0, adHoc: 0 };
      const totalCount = completions.projects + completions.adHoc;

      let level: number;
      if (totalCount === 0) level = 0;
      else if (totalCount === 1) level = 1;
      else if (totalCount === 2) level = 2;
      else if (totalCount <= 4) level = 3;
      else level = 4;

      if (totalCount > maxCount) maxCount = totalCount;
      totalDays++;

      days.push({
        date: d,
        level,
        count: totalCount,
        projectCount: completions.projects,
        adHocCount: completions.adHoc,
      });
    }
    weeks.push(days);
  }

  return { weeks, totalDays, maxCount };
}

// =============================================================================
// ENGAGEMENTS LIST (paginated)
// =============================================================================

export async function computeEngagementsList(filters: EngagementFilters, serverConstraints: ServerConstraints = {}): Promise<EngagementsResponse> {
  if (!hasDb()) return getMockEngagementsList(filters);

  const resolved = await resolveOfficeMembers(filters);
  const { whereClause, params } = buildFilterClause(resolved, 'e', serverConstraints);
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const offset = (page - 1) * pageSize;

  // Translate the sortBy array into a list of ORDER BY fragments. Each entry
  // produces "<col> <dir> NULLS FIRST|LAST". Unknown column names are ignored
  // (rather than silently falling back to a different column).
  const sortClauses: string[] = [];
  const seen = new Set<string>();
  for (const spec of filters.sortBy ?? []) {
    const sortCol = SORT_COLUMN_MAP[spec.column];
    if (!sortCol || seen.has(sortCol)) continue;
    seen.add(sortCol);
    const sortDir = spec.direction === 'asc' ? 'ASC' : 'DESC';
    const nullsOrder = sortDir === 'DESC' ? 'NULLS FIRST' : 'NULLS LAST';
    sortClauses.push(`${sortCol} ${sortDir} ${nullsOrder}`);
  }
  if (sortClauses.length === 0) {
    sortClauses.push('date_finished DESC NULLS FIRST');
  }
  // `id DESC` is the final tiebreaker so pagination stays stable when the
  // sort columns produce ties.
  const orderBy = `${sortClauses.join(', ')}, id DESC`;

  const [countRows, dataRows] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT COUNT(*) AS total FROM engagements e ${CLIENT_JOIN} ${whereClause}`,
      params
    ),
    query<Record<string, unknown>>(
      `SELECT e.*, c.name AS client_name, c.crn_pending AS client_crn_pending,
         (SELECT COUNT(*) FROM engagement_notes WHERE engagement_id = e.id) AS note_count
       FROM engagements e ${CLIENT_JOIN} ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    ),
  ]);

  const total = Number(countRows[0]?.total ?? 0);

  return {
    engagements: dataRows.map(r => rowToEngagement(r)),
    total,
    page,
    pageSize,
    hasMore: offset + pageSize < total,
  };
}

// =============================================================================
// PERIOD START HELPER (re-export for routes)
// =============================================================================
export { getPeriodStartISO };
