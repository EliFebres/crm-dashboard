/**
 * =============================================================================
 * KPI DASHBOARD API
 * =============================================================================
 *
 * Team-oriented KPI dashboard. Scope is always team-level or cross-team —
 * no individual-level views. No team-vs-team competitive comparisons.
 */

const API_BASE_URL = '/api';

// =============================================================================
// TYPES
// =============================================================================

export type KpiScope = 'all' | `team:${string}`;

export interface KpiFilters {
  scope: KpiScope;
  period: string;
  clientDepts?: string[];
  intakeTypes?: string[];
  /** Stale threshold key (see STALE_THRESHOLDS). Defaults server-side to '3m'. */
  staleThreshold?: string;
}

/**
 * How long open work must be ongoing to count as "stale". Single source of truth
 * shared by the UI (labels) and the server query (SQLite date modifier). NOTE:
 * SQLite has no "weeks" modifier, so weeks are expressed in days. Insertion order
 * is the menu order.
 */
export const STALE_THRESHOLDS: Record<string, { label: string; modifier: string }> = {
  '1w': { label: '1 week', modifier: '-7 days' },
  '2w': { label: '2 weeks', modifier: '-14 days' },
  '3w': { label: '3 weeks', modifier: '-21 days' },
  '1m': { label: '1 month', modifier: '-1 months' },
  '2m': { label: '2 months', modifier: '-2 months' },
  '3m': { label: '3 months', modifier: '-3 months' },
  '6m': { label: '6 months', modifier: '-6 months' },
  '1y': { label: '1 year', modifier: '-12 months' },
};

export const DEFAULT_STALE_THRESHOLD = '3w';

/** Coerce an arbitrary value to a valid threshold key, falling back to the default. */
export function resolveStaleThreshold(value: unknown): string {
  return typeof value === 'string' && STALE_THRESHOLDS[value] ? value : DEFAULT_STALE_THRESHOLD;
}

export interface KpiDelta {
  value: number;
  deltaPercent: number;
}

export interface HeroKpis {
  interactions: KpiDelta;
  inProgress: KpiDelta;
  nna: KpiDelta;
  avgNnaPerInteraction: KpiDelta;
  completionRate: KpiDelta;
  zeroNnaRate: KpiDelta;
  periodLabel: string;
}

export interface JourneySankeyData {
  // `color` is the managed chart color for intake/project nodes (from the intake/
  // project-type registries); undefined for outcome nodes, which use static colors.
  nodes: { name: string; kind: 'intake' | 'project' | 'outcome'; color?: string }[];
  links: { source: number; target: number; value: number }[];
}

export interface JourneyTemplate {
  signature: string;
  count: number;
  percentOfTotal: number;
  avgNna: number;
  avgDays: number | null;
  completionRate: number;
}

export interface ClientDeptRow {
  dept: string;
  interactions: number;
  nna: number;
  nnaPerInteraction: number;
  color: string; // Chart color, resolved from the managed departments table
}

export interface NnaConcentrationPoint {
  rank: number;
  clientName: string;
  clientDept: string;
  nna: number;
  cumulativeShare: number;
}

export interface NnaConcentration {
  totalNna: number;
  clients: NnaConcentrationPoint[];
  top5Share: number;
  clientsForEightyPercent: number;
}

export interface StaleEngagement {
  id: number;
  clientDept: string;
  clientName: string;
  type: string;
  status: string;
  daysOpen: number;
  dateStarted: string;
}

export interface DormantClient {
  clientName: string;
  clientDept: string;
  historicalCount: number;
  lastEngagedDate: string;
  daysSinceLast: number;
}

export interface KpiDashboardData {
  scope: { kind: 'all' | 'team'; team?: string };
  periodLabel: string;
  heroKpis: HeroKpis;
  journeySankey: JourneySankeyData;
  journeyTemplates: JourneyTemplate[];
  clientDepts: ClientDeptRow[];
  nnaConcentration: NnaConcentration;
  staleEngagements: StaleEngagement[];
  dormantClients: DormantClient[];
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

export async function getKpiDashboardData(
  filters: KpiFilters,
  signal?: AbortSignal
): Promise<KpiDashboardData> {
  const response = await fetch(`${API_BASE_URL}/kpi/dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope: filters.scope,
      period: filters.period,
      clientDepts: filters.clientDepts ?? [],
      intakeTypes: filters.intakeTypes ?? [],
      staleThreshold: filters.staleThreshold,
    }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 400) throw new Error('Invalid KPI scope.');
    throw new Error('Failed to load KPI dashboard data.');
  }
  return response.json();
}
