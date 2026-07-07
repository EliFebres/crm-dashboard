/**
 * Server-side aggregation functions for the KPI dashboard.
 *
 * Scope model: 'all' (cross-team aggregate) or 'team:<name>' (single team
 * aggregate). There is no individual-level attribution anywhere in this
 * module — team privacy is a hard constraint.
 *
 * DATA SOURCE:
 * - If SQLITE_DIR is set → queries SQLite.
 * - Otherwise returns empty/zero stubs (dev-without-db mode).
 */
import { query } from './index';
import { hasDb } from './connection';
import { departmentColorMap, listDepartmentNames } from './departments';
import { intakeColorMap } from './intakeTypes';
import { projectTypeColorMap, listProjectTypeNames, projectNameForRole } from './projectTypes';
import type { ServerConstraints } from './queries';
import { getPeriodStartISO, getPreviousPeriodDates } from './dateUtils';
import { SQL_COMPLETED, SQL_OPEN } from '../statusHelpers';
import { STALE_THRESHOLDS, resolveStaleThreshold } from '../api/kpi';
import type {
  KpiFilters,
  HeroKpis,
  JourneySankeyData,
  JourneyTemplate,
  ClientDeptRow,
  NnaConcentration,
  StaleEngagement,
  DormantClient,
  WeeklyFlowPoint,
  MixDriftPoint,
  CycleTimeRow,
  ChainRolledRow,
  SegmentMatrix,
  ChaseRow,
  SpawnRateRow,
  ClientBasePoint,
  UniquePerDeptRow,
} from '../api/kpi';

// =============================================================================
// SHARED HELPERS
// =============================================================================

type SqlClause = { whereClause: string; params: unknown[] };

/**
 * Builds a WHERE clause for KPI queries. Unlike buildFilterClause in
 * queries.ts, this is self-contained and only handles the KPI filter shape.
 *
 * `periodOverride` lets callers skip the period filter (e.g. for dormant-
 * client lookups where period is inherent to the metric's definition).
 */
function buildKpiWhere(
  filters: KpiFilters,
  constraints: ServerConstraints,
  opts: { includePeriod?: boolean; tableAlias?: string } = {}
): SqlClause {
  const { includePeriod = true, tableAlias } = opts;
  const col = (c: string) => (tableAlias ? `${tableAlias}.${c}` : c);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (constraints.team) {
    conditions.push(`${col('team')} = ?`);
    params.push(constraints.team);
  }

  if (includePeriod && filters.period) {
    const startISO = getPeriodStartISO(filters.period);
    if (startISO) {
      conditions.push(`${col('date_started')} >= ?`);
      params.push(startISO);
    }
  }

  if (filters.clientDepts && filters.clientDepts.length > 0) {
    const placeholders = filters.clientDepts.map(() => '?').join(', ');
    conditions.push(`${col('internal_client_dept')} IN (${placeholders})`);
    params.push(...filters.clientDepts);
  }

  if (filters.intakeTypes && filters.intakeTypes.length > 0) {
    const placeholders = filters.intakeTypes.map(() => '?').join(', ');
    conditions.push(`${col('intake_type')} IN (${placeholders})`);
    params.push(...filters.intakeTypes);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

function deltaPercent(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return Math.round(((curr - prev) / prev) * 100);
}

/** Parse the engagements.team_members JSON column into a clean string[] of member names. */
function parseAssignees(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  } catch {
    return [];
  }
}

// =============================================================================
// 1. HERO KPIs
// =============================================================================

export async function computeHeroKpis(
  filters: KpiFilters,
  constraints: ServerConstraints
): Promise<HeroKpis> {
  const periodLabel = getPreviousPeriodDates(filters.period || '1Y').label;

  if (!hasDb()) {
    return {
      interactions: { value: 0, deltaPercent: 0 },
      inProgress: { value: 0, deltaPercent: 0 },
      nna: { value: 0, deltaPercent: 0 },
      avgNnaPerInteraction: { value: 0, deltaPercent: 0 },
      completionRate: { value: 0, deltaPercent: 0 },
      zeroNnaRate: { value: 0, deltaPercent: 0 },
      periodLabel,
    };
  }

  // Current period
  const curr = buildKpiWhere(filters, constraints);

  // Previous period — same filters but with the prior period's date range
  const prev = buildKpiWhere(filters, constraints, { includePeriod: false });
  const prevDates = getPreviousPeriodDates(filters.period || '1Y');
  const prevWhere = prev.whereClause
    ? `${prev.whereClause} AND date_started >= ? AND date_started <= ?`
    : 'WHERE date_started >= ? AND date_started <= ?';
  const prevParams = [...prev.params, prevDates.start, prevDates.end];

  const [currRows, prevRows] = await Promise.all([
    query<Record<string, unknown>>(
      `
        SELECT
          COUNT(*)                                                          AS interactions,
          COUNT(*) FILTER (WHERE ${SQL_OPEN})                               AS in_progress,
          COALESCE(SUM(nna), 0)                                             AS total_nna,
          COUNT(*) FILTER (WHERE ${SQL_COMPLETED})                          AS completed,
          COUNT(*) FILTER (WHERE status = 'Completed')                      AS strict_completed,
          COUNT(*) FILTER (WHERE status = 'Completed' AND (nna IS NULL OR nna = 0)) AS zero_nna
        FROM engagements
        ${curr.whereClause}
      `,
      curr.params
    ),
    query<Record<string, unknown>>(
      `
        SELECT
          COUNT(*)                                                          AS interactions,
          COUNT(*) FILTER (WHERE ${SQL_OPEN})                               AS in_progress,
          COALESCE(SUM(nna), 0)                                             AS total_nna,
          COUNT(*) FILTER (WHERE ${SQL_COMPLETED})                          AS completed,
          COUNT(*) FILTER (WHERE status = 'Completed')                      AS strict_completed,
          COUNT(*) FILTER (WHERE status = 'Completed' AND (nna IS NULL OR nna = 0)) AS zero_nna
        FROM engagements
        ${prevWhere}
      `,
      prevParams
    ),
  ]);

  const c = currRows[0] ?? {};
  const p = prevRows[0] ?? {};

  const currInteractions = Number(c.interactions ?? 0);
  const prevInteractions = Number(p.interactions ?? 0);
  const currInProgress = Number(c.in_progress ?? 0);
  const prevInProgress = Number(p.in_progress ?? 0);
  const currNna = Number(c.total_nna ?? 0);
  const prevNna = Number(p.total_nna ?? 0);
  const currCompleted = Number(c.completed ?? 0);
  const prevCompleted = Number(p.completed ?? 0);
  const currStrictCompleted = Number(c.strict_completed ?? 0);
  const prevStrictCompleted = Number(p.strict_completed ?? 0);
  const currZeroNna = Number(c.zero_nna ?? 0);
  const prevZeroNna = Number(p.zero_nna ?? 0);

  const currAvgNna = currInteractions > 0 ? currNna / currInteractions : 0;
  const prevAvgNna = prevInteractions > 0 ? prevNna / prevInteractions : 0;

  const currCompletionRate = pct(currCompleted, currInteractions);
  const prevCompletionRate = pct(prevCompleted, prevInteractions);

  const currZeroNnaRate = pct(currZeroNna, currStrictCompleted);
  const prevZeroNnaRate = pct(prevZeroNna, prevStrictCompleted);

  return {
    interactions: { value: currInteractions, deltaPercent: deltaPercent(currInteractions, prevInteractions) },
    inProgress: { value: currInProgress, deltaPercent: deltaPercent(currInProgress, prevInProgress) },
    nna: { value: currNna, deltaPercent: deltaPercent(currNna, prevNna) },
    avgNnaPerInteraction: { value: Math.round(currAvgNna), deltaPercent: deltaPercent(currAvgNna, prevAvgNna) },
    completionRate: { value: currCompletionRate, deltaPercent: Math.round(currCompletionRate - prevCompletionRate) },
    zeroNnaRate: { value: currZeroNnaRate, deltaPercent: Math.round(currZeroNnaRate - prevZeroNnaRate) },
    periodLabel,
  };
}

// =============================================================================
// 2a. JOURNEY SANKEY (Intake Type → Project Type → Outcome)
// =============================================================================

export async function computeJourneySankey(
  filters: KpiFilters,
  constraints: ServerConstraints
): Promise<JourneySankeyData> {
  if (!hasDb()) return { nodes: [], links: [] };

  const { whereClause, params } = buildKpiWhere(filters, constraints);

  const outcomeExpr = `
    CASE
      WHEN ${SQL_COMPLETED} AND nna IS NOT NULL AND nna > 0 THEN 'Completed w/ NNA'
      WHEN ${SQL_COMPLETED} THEN 'Completed no NNA'
      WHEN NOT (${SQL_COMPLETED}) AND date_started < date('now', '-60 days') THEN 'Stalled'
      ELSE 'Still Open'
    END
  `;

  const [intakeToType, typeToOutcome, intakeColors, projectColors] = await Promise.all([
    query<Record<string, unknown>>(
      `
        SELECT intake_type AS src, type AS tgt, COUNT(*) AS cnt
        FROM engagements
        ${whereClause}
        GROUP BY intake_type, type
      `,
      params
    ),
    query<Record<string, unknown>>(
      `
        SELECT type AS src, ${outcomeExpr} AS tgt, COUNT(*) AS cnt
        FROM engagements
        ${whereClause}
        GROUP BY type, tgt
      `,
      params
    ),
    intakeColorMap(),
    projectTypeColorMap(),
  ]);

  // Build dedup node index with stable kind labels for coloring. Intake/project
  // nodes carry their managed chart color; outcome nodes fall back to static colors.
  const nodeIndex = new Map<string, number>();
  const nodes: JourneySankeyData['nodes'] = [];
  const addNode = (name: string, kind: 'intake' | 'project' | 'outcome'): number => {
    const key = `${kind}|${name}`;
    const existing = nodeIndex.get(key);
    if (existing !== undefined) return existing;
    const idx = nodes.length;
    const color = kind === 'intake' ? intakeColors[name] : kind === 'project' ? projectColors[name] : undefined;
    nodes.push({ name, kind, color });
    nodeIndex.set(key, idx);
    return idx;
  };

  const links: JourneySankeyData['links'] = [];
  for (const r of intakeToType) {
    const src = String(r.src ?? '');
    const tgt = String(r.tgt ?? '');
    const value = Number(r.cnt ?? 0);
    if (!src || !tgt || value <= 0) continue;
    links.push({ source: addNode(src, 'intake'), target: addNode(tgt, 'project'), value });
  }
  for (const r of typeToOutcome) {
    const src = String(r.src ?? '');
    const tgt = String(r.tgt ?? '');
    const value = Number(r.cnt ?? 0);
    if (!src || !tgt || value <= 0) continue;
    links.push({ source: addNode(src, 'project'), target: addNode(tgt, 'outcome'), value });
  }

  return { nodes, links };
}

// =============================================================================
// 2b. JOURNEY TEMPLATES (recursive walk over linked_from_id)
// =============================================================================

export async function computeJourneyTemplates(
  filters: KpiFilters,
  constraints: ServerConstraints
): Promise<JourneyTemplate[]> {
  if (!hasDb()) return [];

  const { whereClause, params } = buildKpiWhere(filters, constraints, { tableAlias: 'e' });
  const rootAndExtras = whereClause
    ? `AND ${whereClause.slice(6)}` // strip leading "WHERE "
    : '';

  const rows = await query<Record<string, unknown>>(
    `
      WITH RECURSIVE journey AS (
        SELECT
          e.id                     AS root_id,
          e.id                     AS id,
          e.intake_type            AS intake_type,
          CAST(e.type AS VARCHAR)  AS path,
          e.type                   AS leaf_type,
          e.status                 AS leaf_status,
          e.nna                    AS leaf_nna,
          e.date_started           AS leaf_started,
          e.date_finished          AS leaf_finished,
          0                        AS depth
        FROM engagements e
        WHERE e.linked_from_id IS NULL
          ${rootAndExtras}

        UNION ALL

        SELECT
          j.root_id,
          c.id,
          j.intake_type,
          j.path || ' → ' || c.type AS path,
          c.type,
          c.status,
          c.nna,
          c.date_started,
          c.date_finished,
          j.depth + 1
        FROM engagements c
        JOIN journey j ON c.linked_from_id = j.id
        WHERE j.depth < 6
      ),
      terminal AS (
        -- For each root, take the deepest leaf as the signature's endpoint
        SELECT root_id, intake_type, path, leaf_status, leaf_nna, leaf_started, leaf_finished, depth,
               ROW_NUMBER() OVER (PARTITION BY root_id ORDER BY depth DESC) AS rn
        FROM journey
      )
      SELECT
        intake_type || ' → ' || path || ' → ' ||
          CASE
            WHEN leaf_status IN ('Completed', 'Follow Up') AND leaf_nna IS NOT NULL AND leaf_nna > 0 THEN 'Completed w/ NNA'
            WHEN leaf_status IN ('Completed', 'Follow Up') THEN 'Completed no NNA'
            WHEN leaf_status NOT IN ('Completed', 'Follow Up') AND leaf_started < date('now', '-60 days') THEN 'Stalled'
            ELSE 'Still Open'
          END AS signature,
        COUNT(*) AS journeys,
        AVG(CAST(leaf_nna AS REAL)) AS avg_nna,
        AVG(julianday(leaf_finished) - julianday(leaf_started)) AS avg_days,
        COUNT(*) FILTER (WHERE leaf_status IN ('Completed', 'Follow Up')) AS completed_count
      FROM terminal
      WHERE rn = 1
      GROUP BY signature
      ORDER BY journeys DESC
      LIMIT 10
    `,
    params
  );

  const totalJourneys = rows.reduce((s, r) => s + Number(r.journeys ?? 0), 0);
  return rows.map(r => {
    const count = Number(r.journeys ?? 0);
    const completed = Number(r.completed_count ?? 0);
    const avgDays = r.avg_days != null ? Math.round(Number(r.avg_days)) : null;
    return {
      signature: String(r.signature ?? ''),
      count,
      percentOfTotal: pct(count, totalJourneys),
      avgNna: Math.round(Number(r.avg_nna ?? 0)),
      avgDays,
      completionRate: pct(completed, count),
    };
  });
}

// =============================================================================
// 3a. CLIENT DEPT BREAKDOWN
// =============================================================================

export async function computeClientDeptBreakdown(
  filters: KpiFilters,
  constraints: ServerConstraints
): Promise<ClientDeptRow[]> {
  if (!hasDb()) return [];
  const { whereClause, params } = buildKpiWhere(filters, constraints);

  const [rows, deptColors] = await Promise.all([
    query<Record<string, unknown>>(
      `
        SELECT
          internal_client_dept  AS dept,
          COUNT(*)              AS interactions,
          COALESCE(SUM(nna), 0) AS total_nna
        FROM engagements
        ${whereClause}
        GROUP BY internal_client_dept
        ORDER BY interactions DESC
      `,
      params
    ),
    departmentColorMap(),
  ]);

  return rows.map(r => {
    const interactions = Number(r.interactions ?? 0);
    const nna = Number(r.total_nna ?? 0);
    const dept = String(r.dept ?? '');
    return {
      dept,
      interactions,
      nna,
      nnaPerInteraction: interactions > 0 ? Math.round(nna / interactions) : 0,
      color: deptColors[dept] || '#71717a',
    };
  });
}

// =============================================================================
// 3b. NNA CONCENTRATION (Pareto)
// =============================================================================

export async function computeNnaConcentration(
  filters: KpiFilters,
  constraints: ServerConstraints
): Promise<NnaConcentration> {
  if (!hasDb()) {
    return { totalNna: 0, clients: [], top5Share: 0, clientsForEightyPercent: 0 };
  }
  const { whereClause, params } = buildKpiWhere(filters, constraints);

  const rows = await query<Record<string, unknown>>(
    `
      SELECT
        internal_client_name AS client,
        internal_client_dept AS dept,
        COALESCE(SUM(nna), 0) AS total_nna
      FROM engagements
      ${whereClause
        ? `${whereClause} AND nna IS NOT NULL AND nna > 0`
        : `WHERE nna IS NOT NULL AND nna > 0`}
      GROUP BY internal_client_name, internal_client_dept
      ORDER BY total_nna DESC
      LIMIT 15
    `,
    params
  );

  const totalNna = rows.reduce((s, r) => s + Number(r.total_nna ?? 0), 0);
  let cumulative = 0;
  const clients = rows.map((r, i) => {
    const nna = Number(r.total_nna ?? 0);
    cumulative += nna;
    return {
      rank: i + 1,
      clientName: String(r.client ?? ''),
      clientDept: String(r.dept ?? ''),
      nna,
      cumulativeShare: pct(cumulative, totalNna),
    };
  });

  const top5 = clients.slice(0, 5).reduce((s, c) => s + c.nna, 0);
  const eightyPercentMark = clients.findIndex(c => c.cumulativeShare >= 80);

  return {
    totalNna,
    clients,
    top5Share: pct(top5, totalNna),
    clientsForEightyPercent: eightyPercentMark >= 0 ? eightyPercentMark + 1 : clients.length,
  };
}

// =============================================================================
// 6a. STALE IN-PROGRESS ENGAGEMENTS
// =============================================================================

export async function computeStaleEngagements(
  filters: KpiFilters,
  constraints: ServerConstraints
): Promise<StaleEngagement[]> {
  if (!hasDb()) return [];
  // Period-independent: stale is defined by absolute age, not selected window.
  const { whereClause, params } = buildKpiWhere(filters, constraints, { includePeriod: false });

  // "Stale" = still open AND started at least the chosen threshold ago. The
  // modifier comes from a fixed allowlist (STALE_THRESHOLDS), so interpolation
  // here is injection-safe.
  const threshold = resolveStaleThreshold(filters.staleThreshold);
  const staleClause = `date_started <= date('now', '${STALE_THRESHOLDS[threshold].modifier}')`;

  const rows = await query<Record<string, unknown>>(
    `
      SELECT
        id,
        internal_client_dept AS dept,
        internal_client_name AS client,
        type,
        status,
        CAST(julianday(date('now')) - julianday(date_started) AS INTEGER) AS days_open,
        CAST(date_started AS TEXT) AS date_started
      FROM engagements
      ${whereClause
        ? `${whereClause} AND ${SQL_OPEN} AND ${staleClause}`
        : `WHERE ${SQL_OPEN} AND ${staleClause}`}
      ORDER BY date_started ASC
      LIMIT 10
    `,
    params
  );

  return rows.map(r => ({
    id: Number(r.id ?? 0),
    clientDept: String(r.dept ?? ''),
    clientName: String(r.client ?? ''),
    type: String(r.type ?? ''),
    status: String(r.status ?? ''),
    daysOpen: Number(r.days_open ?? 0),
    dateStarted: String(r.date_started ?? '').split('T')[0],
  }));
}

// =============================================================================
// 6b. DORMANT CONTACTS
// =============================================================================

export async function computeDormantClients(
  filters: KpiFilters,
  constraints: ServerConstraints
): Promise<DormantClient[]> {
  if (!hasDb()) return [];
  // Period-independent — dormancy uses all-time history
  const { whereClause, params } = buildKpiWhere(filters, constraints, { includePeriod: false });

  const rows = await query<Record<string, unknown>>(
    `
      SELECT
        internal_client_name AS client,
        internal_client_dept AS dept,
        COUNT(*)             AS total_count,
        MAX(date_started)    AS last_started,
        CAST(julianday(date('now')) - julianday(MAX(date_started)) AS INTEGER) AS days_since
      FROM engagements
      ${whereClause}
      GROUP BY internal_client_name, internal_client_dept
      HAVING COUNT(*) >= 3
         AND MAX(date_started) < date('now', '-60 days')
      ORDER BY days_since DESC
      LIMIT 10
    `,
    params
  );

  const mapped = rows.map(r => ({
    clientName: String(r.client ?? ''),
    clientDept: String(r.dept ?? ''),
    historicalCount: Number(r.total_count ?? 0),
    lastEngagedDate: String(r.last_started ?? '').split('T')[0],
    daysSinceLast: Number(r.days_since ?? 0),
    assignees: [] as string[],
  }));

  // Attach the team member(s) from each dormant client's most recent engagement
  // (the one that set their last-engaged date). Kept scope-consistent via `team`.
  if (mapped.length) {
    const names = mapped.map(m => m.clientName);
    const placeholders = names.map(() => '?').join(', ');
    const teamClause = constraints.team ? 'AND team = ?' : '';
    const latestParams = constraints.team ? [...names, constraints.team] : names;
    const latest = await query<Record<string, unknown>>(
      `
        SELECT name, team_members FROM (
          SELECT internal_client_name AS name, team_members,
                 ROW_NUMBER() OVER (PARTITION BY internal_client_name ORDER BY date_started DESC, id DESC) AS rn
          FROM engagements
          WHERE internal_client_name IN (${placeholders}) ${teamClause}
        ) WHERE rn = 1
      `,
      latestParams
    );
    const byName = new Map<string, string[]>();
    for (const r of latest) byName.set(String(r.name ?? ''), parseAssignees(r.team_members));
    for (const m of mapped) m.assignees = byName.get(m.clientName) ?? [];
  }

  return mapped;
}

// =============================================================================
// EXTENDED METRICS — the "Briefing" redesign (Q2, Q3, Q4, Q8, Q9, Q10, Q12, Q13)
//
// These are intentionally SCOPE(team)-ONLY. Per the redesign spec, each uses a
// fixed intrinsic window (26 weeks / 12 months / all-completed / all-history) and
// does not respond to the period, clientDepts, or intakeTypes filters. So the only
// constraint applied is the team scope; `buildTeamWhere` emits exactly that.
// =============================================================================

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Team-only WHERE clause (ignores period / dept / intake). */
function buildTeamWhere(constraints: ServerConstraints, alias?: string): SqlClause {
  const col = (c: string) => (alias ? `${alias}.${c}` : c);
  if (constraints.team) {
    return { whereClause: `WHERE ${col('team')} = ?`, params: [constraints.team] };
  }
  return { whereClause: '', params: [] };
}

/** Append an extra condition to a (possibly empty) WHERE clause. */
function andWhere(base: string, condition: string): string {
  return base ? `${base} AND ${condition}` : `WHERE ${condition}`;
}

/** Linear-interpolated quantile over a pre-sorted ascending array (matches the redesign spec). */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Month key = year*12 + month, derived from an ISO ("YYYY-MM-DD") or "YYYY-MM" string. */
function isoMonthKey(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)); // 1-based
  return y * 12 + (m - 1);
}

// -----------------------------------------------------------------------------
// Q2 — WEEKLY OPENED vs COMPLETED (last 26 weeks)
// -----------------------------------------------------------------------------

export async function computeWeeklyFlow(constraints: ServerConstraints): Promise<WeeklyFlowPoint[]> {
  const WEEKS = 26;
  const now = Date.now();
  const DAY = 86400000;
  // Pre-build 26 ordered buckets: index 0 = oldest, index 25 = current week.
  const buckets: WeeklyFlowPoint[] = Array.from({ length: WEEKS }, (_, i) => {
    const weeksAgo = WEEKS - 1 - i;
    const d = new Date(now - weeksAgo * 7 * DAY);
    return { weeksAgo: i, opened: 0, completed: 0, label: `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}` };
  });
  if (!hasDb()) return buckets;

  const { whereClause, params } = buildTeamWhere(constraints);
  const [openedRows, completedRows] = await Promise.all([
    query<Record<string, unknown>>(
      `
        SELECT CAST((julianday('now') - julianday(date_started)) / 7 AS INTEGER) AS wk, COUNT(*) AS cnt
        FROM engagements
        ${andWhere(whereClause, `date_started >= date('now', '-183 days')`)}
        GROUP BY wk
      `,
      params
    ),
    query<Record<string, unknown>>(
      `
        SELECT CAST((julianday('now') - julianday(date_finished)) / 7 AS INTEGER) AS wk, COUNT(*) AS cnt
        FROM engagements
        ${andWhere(whereClause, `date_finished IS NOT NULL AND date_finished >= date('now', '-183 days')`)}
        GROUP BY wk
      `,
      params
    ),
  ]);

  // wk = whole weeks ago (0 = current). Bucket index = WEEKS-1-wk.
  for (const r of openedRows) {
    const wk = Number(r.wk ?? -1);
    if (wk >= 0 && wk < WEEKS) buckets[WEEKS - 1 - wk].opened = Number(r.cnt ?? 0);
  }
  for (const r of completedRows) {
    const wk = Number(r.wk ?? -1);
    if (wk >= 0 && wk < WEEKS) buckets[WEEKS - 1 - wk].completed = Number(r.cnt ?? 0);
  }
  return buckets;
}

// -----------------------------------------------------------------------------
// Q3 — WORK-MIX DRIFT (high-touch vs data-task share, last 12 months)
// -----------------------------------------------------------------------------

export async function computeMixDrift(constraints: ServerConstraints): Promise<MixDriftPoint[]> {
  const now = new Date();
  // 12 ordered month buckets ending on the current month.
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { key: d.getFullYear() * 12 + d.getMonth(), label: MONTH_ABBR[d.getMonth()], high: 0, total: 0 };
  });
  const empty = months.map(m => ({ label: m.label, highPct: 0, lowPct: 0, total: 0 }));
  if (!hasDb()) return empty;

  // "High-touch" set from the redesign spec; PCR resolved via its stable role so a
  // rename of the built-in doesn't drop it from the set.
  const pcr = await projectNameForRole('pcr');
  const highSet = ['Discovery Meeting', 'Meeting', 'Follow-up Meeting', pcr];
  const placeholders = highSet.map(() => '?').join(', ');

  const { whereClause, params } = buildTeamWhere(constraints);
  const rows = await query<Record<string, unknown>>(
    `
      SELECT strftime('%Y-%m', date_started) AS ym,
             COUNT(*) FILTER (WHERE type IN (${placeholders})) AS high,
             COUNT(*) AS total
      FROM engagements
      ${andWhere(whereClause, `date_started >= date('now', '-11 months', 'start of month')`)}
      GROUP BY ym
    `,
    [...params, ...highSet]
  );

  const byKey = new Map(months.map(m => [m.key, m]));
  for (const r of rows) {
    const ym = String(r.ym ?? '');
    if (!ym) continue;
    const key = isoMonthKey(ym + '-01');
    const m = byKey.get(key);
    if (!m) continue;
    m.high = Number(r.high ?? 0);
    m.total = Number(r.total ?? 0);
  }

  return months.map(m => ({
    label: m.label,
    highPct: m.total ? (m.high / m.total) * 100 : 0,
    lowPct: m.total ? ((m.total - m.high) / m.total) * 100 : 0,
    total: m.total,
  }));
}

// -----------------------------------------------------------------------------
// Q4 — CYCLE TIME by project type (median + P90 days, completed work only)
// -----------------------------------------------------------------------------

export async function computeCycleTimes(constraints: ServerConstraints): Promise<CycleTimeRow[]> {
  if (!hasDb()) return [];
  const { whereClause, params } = buildTeamWhere(constraints);
  const [rows, colors] = await Promise.all([
    query<Record<string, unknown>>(
      `
        SELECT type, julianday(date_finished) - julianday(date_started) AS days
        FROM engagements
        ${andWhere(whereClause, `date_finished IS NOT NULL`)}
      `,
      params
    ),
    projectTypeColorMap(),
  ]);

  const byType = new Map<string, number[]>();
  for (const r of rows) {
    const type = String(r.type ?? '');
    const days = Number(r.days ?? 0);
    if (!type) continue;
    const arr = byType.get(type) ?? [];
    arr.push(days);
    byType.set(type, arr);
  }

  return [...byType.entries()]
    .map(([type, arr]) => {
      arr.sort((a, b) => a - b);
      return {
        type,
        count: arr.length,
        median: quantile(arr, 0.5),
        p90: quantile(arr, 0.9),
        color: colors[type] || '#71717a',
      };
    })
    .filter(c => c.count >= 5)
    .sort((a, b) => b.median - a.median);
}

// -----------------------------------------------------------------------------
// Q8 — CHAIN-ROLLED NNA attribution by originating type
// -----------------------------------------------------------------------------

export async function computeChainRolled(constraints: ServerConstraints): Promise<ChainRolledRow[]> {
  if (!hasDb()) return [];
  const { whereClause, params } = buildTeamWhere(constraints, 'e');
  const rootExtra = whereClause ? `AND ${whereClause.slice(6)}` : ''; // strip leading "WHERE "

  const [rows, colors] = await Promise.all([
    query<Record<string, unknown>>(
      `
        WITH RECURSIVE chain AS (
          SELECT e.id AS root_id, e.type AS root_type, e.id AS id, e.nna AS nna, 0 AS depth
          FROM engagements e
          WHERE e.linked_from_id IS NULL
            ${rootExtra}

          UNION ALL

          SELECT c.root_id, c.root_type, ch.id, ch.nna, c.depth + 1
          FROM engagements ch
          JOIN chain c ON ch.linked_from_id = c.id
          WHERE c.depth < 6
        )
        SELECT root_type AS type,
               SUM(CASE WHEN depth = 0 THEN COALESCE(nna, 0) ELSE 0 END) AS direct_nna,
               SUM(COALESCE(nna, 0)) AS rolled_nna
        FROM chain
        GROUP BY root_type
      `,
      params
    ),
    projectTypeColorMap(),
  ]);

  return rows
    .map(r => {
      const type = String(r.type ?? '');
      const directNna = Number(r.direct_nna ?? 0);
      const rolledNna = Number(r.rolled_nna ?? 0);
      const downstream = rolledNna - directNna;
      const uplift = directNna ? (rolledNna / directNna - 1) * 100 : (rolledNna > 0 ? 100 : 0);
      return { type, directNna, rolledNna, downstream, uplift, color: colors[type] || '#71717a' };
    })
    .sort((a, b) => b.rolledNna - a.rolledNna);
}

// -----------------------------------------------------------------------------
// Q9 — SEGMENT CONVERSION MATRIX (project type × client department)
// -----------------------------------------------------------------------------

export async function computeSegmentMatrix(constraints: ServerConstraints): Promise<SegmentMatrix> {
  const [deptNames, typeNames] = await Promise.all([listDepartmentNames(), listProjectTypeNames()]);
  const depts = deptNames;
  const types = typeNames.filter(t => t !== 'Other');
  const empty: SegmentMatrix = { depts, types, cells: {} };
  if (!hasDb()) return empty;

  const { whereClause, params } = buildTeamWhere(constraints);
  // Strict Completed only (excludes Follow Up), matching the redesign spec.
  const rows = await query<Record<string, unknown>>(
    `
      SELECT type, internal_client_dept AS dept, nna
      FROM engagements
      ${andWhere(whereClause, `status = 'Completed'`)}
    `,
    params
  );

  type Agg = { completed: number; hits: number; nnas: number[] };
  const map = new Map<string, Agg>();
  for (const r of rows) {
    const type = String(r.type ?? '');
    const dept = String(r.dept ?? '');
    const nna = r.nna == null ? null : Number(r.nna);
    const key = `${type}|${dept}`;
    const g = map.get(key) ?? { completed: 0, hits: 0, nnas: [] };
    g.completed++;
    if (nna != null && nna > 0) {
      g.hits++;
      g.nnas.push(nna);
    }
    map.set(key, g);
  }

  const cells: SegmentMatrix['cells'] = {};
  for (const t of types) {
    for (const d of depts) {
      const key = `${t}|${d}`;
      const g = map.get(key);
      cells[key] = g && g.completed >= 3
        ? {
            n: g.completed,
            hitRate: (g.hits / g.completed) * 100,
            medianNna: g.nnas.length ? quantile(g.nnas.sort((a, b) => a - b), 0.5) : 0,
          }
        : null;
    }
  }

  return { depts, types, cells };
}

// -----------------------------------------------------------------------------
// Q10 — CHASE LIST (strict Completed ≥30d ago, NNA still blank)
// -----------------------------------------------------------------------------

export async function computeChaseList(constraints: ServerConstraints): Promise<ChaseRow[]> {
  if (!hasDb()) return [];
  const { whereClause, params } = buildTeamWhere(constraints);
  const rows = await query<Record<string, unknown>>(
    `
      SELECT internal_client_name AS client, internal_client_dept AS dept, type,
             date_finished AS finished, team_members,
             CAST(julianday('now') - julianday(date_finished) AS INTEGER) AS days_since
      FROM engagements
      ${andWhere(
        whereClause,
        `status = 'Completed' AND date_finished IS NOT NULL AND date_finished <= date('now', '-30 days') AND nna IS NULL`
      )}
      ORDER BY days_since DESC
      LIMIT 10
    `,
    params
  );

  return rows.map(r => ({
    clientName: String(r.client ?? ''),
    clientDept: String(r.dept ?? ''),
    type: String(r.type ?? ''),
    finished: String(r.finished ?? '').split('T')[0],
    daysSince: Number(r.days_since ?? 0),
    assignees: parseAssignees(r.team_members),
  }));
}

// -----------------------------------------------------------------------------
// Q12 — FOLLOW-UP SPAWN RATE by originating type
// -----------------------------------------------------------------------------

export async function computeSpawnRate(constraints: ServerConstraints): Promise<SpawnRateRow[]> {
  if (!hasDb()) return [];
  const { whereClause, params } = buildTeamWhere(constraints, 'e');
  const [rows, colors] = await Promise.all([
    query<Record<string, unknown>>(
      `
        SELECT e.type AS type,
               COUNT(*) AS cnt,
               SUM(CASE WHEN EXISTS (SELECT 1 FROM engagements c WHERE c.linked_from_id = e.id) THEN 1 ELSE 0 END) AS spawned
        FROM engagements e
        ${whereClause}
        GROUP BY e.type
      `,
      params
    ),
    projectTypeColorMap(),
  ]);

  return rows
    .map(r => {
      const type = String(r.type ?? '');
      const count = Number(r.cnt ?? 0);
      const spawned = Number(r.spawned ?? 0);
      return { type, count, spawned, pct: count ? (spawned / count) * 100 : 0, color: colors[type] || '#71717a' };
    })
    .filter(g => g.count >= 8)
    .sort((a, b) => b.pct - a.pct);
}

// -----------------------------------------------------------------------------
// Q13 — CLIENT BASE (new vs returning per month, 12m) + unique clients per dept (1Y)
// -----------------------------------------------------------------------------

export async function computeClientBase(
  constraints: ServerConstraints
): Promise<{ clientBase: ClientBasePoint[]; uniquePerDept: UniquePerDeptRow[] }> {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return { key: d.getFullYear() * 12 + d.getMonth(), label: MONTH_ABBR[d.getMonth()], all: new Set<string>(), fresh: new Set<string>() };
  });
  const deptNames = await listDepartmentNames();
  const deptColors = await departmentColorMap();

  if (!hasDb()) {
    return {
      clientBase: months.map(m => ({ label: m.label, newN: 0, returningN: 0 })),
      uniquePerDept: deptNames.map(d => ({ dept: d, color: deptColors[d] || '#71717a', unique: 0 })),
    };
  }

  const { whereClause, params } = buildTeamWhere(constraints);

  const [firstRows, scopeRows, uniqRows] = await Promise.all([
    // First-ever engagement per client, across ALL teams (defines "new").
    query<Record<string, unknown>>(
      `SELECT internal_client_name AS name, MIN(date_started) AS first FROM engagements GROUP BY internal_client_name`
    ),
    // In-scope engagements over the last 12 months.
    query<Record<string, unknown>>(
      `
        SELECT internal_client_name AS name, date_started AS ds
        FROM engagements
        ${andWhere(whereClause, `date_started >= date('now', '-11 months', 'start of month')`)}
      `,
      params
    ),
    // Unique clients per dept over the last year.
    query<Record<string, unknown>>(
      `
        SELECT internal_client_dept AS dept, COUNT(DISTINCT internal_client_name) AS uniq
        FROM engagements
        ${andWhere(whereClause, `date_started >= date('now', '-365 days')`)}
        GROUP BY internal_client_dept
      `,
      params
    ),
  ]);

  const firstMonthByClient = new Map<string, number>();
  for (const r of firstRows) {
    const name = String(r.name ?? '');
    const first = String(r.first ?? '');
    if (name && first) firstMonthByClient.set(name, isoMonthKey(first));
  }

  const byKey = new Map(months.map(m => [m.key, m]));
  for (const r of scopeRows) {
    const name = String(r.name ?? '');
    const ds = String(r.ds ?? '');
    if (!name || !ds) continue;
    const key = isoMonthKey(ds);
    const m = byKey.get(key);
    if (!m) continue;
    m.all.add(name);
    if (firstMonthByClient.get(name) === key) m.fresh.add(name);
  }

  const clientBase = months.map(m => ({
    label: m.label,
    newN: m.fresh.size,
    returningN: m.all.size - m.fresh.size,
  }));

  const uniqByDept = new Map<string, number>();
  for (const r of uniqRows) uniqByDept.set(String(r.dept ?? ''), Number(r.uniq ?? 0));
  const uniquePerDept = deptNames
    .map(d => ({ dept: d, color: deptColors[d] || '#71717a', unique: uniqByDept.get(d) ?? 0 }))
    .sort((a, b) => b.unique - a.unique);

  return { clientBase, uniquePerDept };
}
