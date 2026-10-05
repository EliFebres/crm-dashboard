/**
 * =============================================================================
 * DEVELOPMENT REPORT API (founder only)
 * =============================================================================
 *
 * The founder's software-development record: monthly code stats, the tools they've
 * built, and daily tool usage pasted from Excel. It becomes page two of their
 * year-to-date review PDF (page one is their KPI report). Every route behind this
 * re-checks that the caller is the founder (/api/dev-report/*).
 */
import type { UsageRow } from '@/app/lib/dev-report/parseUsage';

const API_BASE_URL = '/api/dev-report';

// =============================================================================
// TYPES
// =============================================================================

/** Series colors for tools (readable on the dark page and on paper), assigned in inventory order. */
export const DEV_TOOL_PALETTE = ['#22d3ee', '#8b5cf6', '#f97316', '#10b981', '#f43f5e', '#f59e0b', '#3b82f6', '#14b8a6', '#a855f7', '#84cc16'];

export type DevToolStatus = 'live' | 'beta' | 'retired';
export const DEV_TOOL_STATUSES: DevToolStatus[] = ['live', 'beta', 'retired'];

/** One month of code stats. `month` is YYYY-MM. */
export interface DevCodeMonth {
  month: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
}

export interface DevTool {
  id: string;
  name: string;
  description: string | null;
  status: DevToolStatus;
  /** ISO date the tool launched. */
  launchedOn: string | null;
  /** Estimated minutes one use saves; drives the hours-saved figures. */
  minutesSavedPerUse: number | null;
  /** People using the tool. */
  usersReached: number | null;
  sortOrder: number;
  /** Uses so far this year. */
  usesYtd: number;
}

/** Editable fields of a tool (create / update body). */
export type DevToolInput = Partial<Pick<DevTool, 'name' | 'description' | 'status' | 'launchedOn' | 'minutesSavedPerUse' | 'usersReached'>>;

/** Everything the entry page edits. */
export interface DevReportInputs {
  year: number;
  months: DevCodeMonth[];
  tools: DevTool[];
  usage: {
    rows: number;
    totalUses: number;
    firstDay: string | null;
    lastDay: string | null;
    toolCount: number;
  };
}

/** The computed YTD report: page two of the review PDF, and the entry page's summary. */
export interface DevReportData {
  year: number;
  /** Jan 1 → today, ISO dates. */
  range: { start: string; end: string };
  generatedAt: string;
  code: {
    commits: number;
    added: number;
    deleted: number;
    net: number;
    /** Months with any numbers entered. */
    monthsEntered: number;
    /** Jan → current month. */
    months: { month: string; label: string; commits: number; added: number; deleted: number }[];
  };
  usage: {
    total: number;
    /** First and last tracked day this year (null when nothing is tracked). */
    firstDay: string | null;
    lastDay: string | null;
    /** Average uses per calendar day from firstDay through lastDay. */
    avgPerDay: number;
    busiestDay: { day: string; count: number } | null;
    /** Weekly totals (weeks start Monday) from the first tracked week through this week. */
    weekly: { weekStart: string; label: string; value: number }[];
    byTool: { name: string; uses: number; color: string }[];
    /** Latest full month vs the first full tracked month. */
    growth: { fromLabel: string; toLabel: string; pct: number } | null;
  };
  impact: {
    hoursSaved: number;
    /** hoursSaved / 40. */
    workWeeks: number;
    byTool: { name: string; hours: number; color: string }[];
    /** Tools used this year that have no minutes-saved estimate yet. */
    toolsMissingEstimate: string[];
  };
  tools: {
    live: number;
    beta: number;
    retired: number;
    largestAudience: { name: string; users: number } | null;
    list: {
      name: string;
      status: DevToolStatus;
      launchedOn: string | null;
      usersReached: number | null;
      uses: number;
      color: string;
    }[];
  };
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function send<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? fallback);
  return data as T;
}

export function getDevReportInputs(): Promise<DevReportInputs> {
  return send('', { method: 'GET' }, "Couldn't load your development data.");
}

export function getDevReport(): Promise<DevReportData> {
  return send('/report', { method: 'GET' }, "Couldn't build the development report.");
}

export function saveCodeMonths(months: DevCodeMonth[]): Promise<{ months: DevCodeMonth[] }> {
  return send('/code-months', { method: 'PUT', body: JSON.stringify({ months }) }, "Couldn't save the code stats.");
}

export function createDevTool(input: DevToolInput): Promise<DevTool> {
  return send('/tools', { method: 'POST', body: JSON.stringify(input) }, "Couldn't add the tool.");
}

export function updateDevTool(id: string, patch: DevToolInput): Promise<DevTool> {
  return send(`/tools/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }, "Couldn't save the tool.");
}

export function deleteDevTool(id: string): Promise<{ ok: true }> {
  return send(`/tools/${encodeURIComponent(id)}`, { method: 'DELETE' }, "Couldn't delete the tool.");
}

export function importUsage(rows: UsageRow[]): Promise<{ imported: number; createdTools: string[] }> {
  return send('/usage', { method: 'POST', body: JSON.stringify({ rows }) }, "Couldn't import the usage rows.");
}

export function clearUsage(): Promise<{ ok: true }> {
  return send('/usage', { method: 'DELETE' }, "Couldn't clear the usage data.");
}
