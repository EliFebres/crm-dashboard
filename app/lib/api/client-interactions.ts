/**
 * =============================================================================
 * CLIENT INTERACTIONS API
 * =============================================================================
 *
 * API functions for the Client Interactions Dashboard.
 * All data is served from SQLite via Next.js Route Handlers under /api/client-interactions/.
 *
 * STRUCTURE:
 * 1. TypeScript Interfaces
 * 2. API Functions
 */

import type {
  Engagement,
  EngagementLinkSummary,
  Client,
  NoteEntry,
  DayData,
  DepartmentData,
  IntakeBreakdown,
  IntakeSourceBreakdown,
  NNATier,
} from '../types/engagements';

const API_BASE_URL = '/api';

/** Thrown when a PATCH is rejected because another user edited the same engagement. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// =============================================================================
// TYPESCRIPT INTERFACES
// =============================================================================

/** A single column in a multi-column sort. Order in the sortBy array is the
 *  ORDER BY priority (first entry is the primary sort). */
export interface SortSpec {
  column: string;
  direction: 'asc' | 'desc';
}

/** Filters for fetching engagements */
export interface EngagementFilters {
  search?: string;                 // Text search across multiple fields
  teamMember?: string;             // 'All Team Members', 'Austin Office', 'Charlotte Office', or member name
  departments?: string[];          // Multi-select: ['Advisory', 'Brokerage', 'Institutional']
  intakeTypes?: string[];          // Multi-select: ['IRQ', 'SERF', 'Ad-Hoc']
  projectTypes?: string[];         // Multi-select: ['Meeting', 'Discovery Meeting', 'Data Request', 'Data Update', 'PCR', 'Other']
  period?: string;                 // '1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'
  status?: string;                 // 'In Progress', 'Awaiting Meeting', 'Follow Up', 'Completed'
  page?: number;                   // Pagination: page number (1-indexed)
  pageSize?: number;               // Pagination: items per page (default 50)
  sortBy?: SortSpec[];             // Multi-column sort, applied in order
}

/** Serializes a sortBy array into repeatable URL query params: `sort=col:dir`. */
function appendSortParams(params: URLSearchParams, sortBy: SortSpec[] | undefined): void {
  for (const s of sortBy ?? []) {
    params.append('sort', `${s.column}:${s.direction}`);
  }
}

/** A single internal client with their department */
export interface InternalClientOption {
  name: string;
  dept: string;
}

/** Paginated engagements response */
export interface EngagementsResponse {
  engagements: Engagement[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Pre-computed metrics for dashboard cards */
export interface DashboardMetrics {
  clientProjects: {
    count: number;
    changePercent: number;
    periodLabel: string;
    intakeSourceBreakdown: IntakeSourceBreakdown;
  };
  adHoc: {
    count: number;
    changePercent: number;
    periodLabel: string;
    intakeBreakdown: IntakeBreakdown[];
  };
  inProgress: {
    count: number;
    change: number;
    sparklineData: { value: number }[];
  };
  nna: {
    total: number;
    projectCount: number;
    changePercent: number;
    tiers: NNATier[];
  };
}

/** Department breakdown for chart */
export interface DepartmentBreakdown {
  departments: DepartmentData[];
  total: number;
}

/** Contribution heatmap data (GitHub-style activity graph) */
export interface ContributionDataResponse {
  weeks: DayData[][];
  totalDays: number;
  maxCount: number;
}

/** Combined dashboard data for initial load */
export interface DashboardData {
  metrics: DashboardMetrics;
  departments: DepartmentBreakdown;
  contributionData: ContributionDataResponse;
  engagements: EngagementsResponse;
  filterOptions: FilterOptions;
}

/** Available filter options */
export interface FilterOptions {
  teamMembers: string[];
  teamMemberGroups: { label: string; options: string[] }[];
  departments: string[];
  intakeTypes: string[];
  projectTypes: string[];
  statuses: string[];
}

// =============================================================================
// API FUNCTIONS
// =============================================================================

/**
 * Fetches all dashboard data in a single call for initial page load.
 * Endpoint: POST /api/client-interactions/dashboard
 */
export async function getDashboardData(filters: EngagementFilters = {}, signal?: AbortSignal): Promise<DashboardData> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/dashboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: filters.period || '1Y',
      teamMember: filters.teamMember,
      departments: filters.departments || [],
      intakeTypes: filters.intakeTypes || [],
      projectTypes: filters.projectTypes || [],
      search: filters.search,
      status: filters.status,
      page: filters.page || 1,
      pageSize: filters.pageSize || 50,
      sortBy: filters.sortBy ?? [],
    }),
    signal,
  });
  if (!response.ok) throw new Error('Failed to fetch dashboard data');
  return response.json();
}

/**
 * Fetches paginated engagements with filtering and sorting.
 * Endpoint: GET /api/client-interactions/engagements
 */
export async function getEngagements(filters: EngagementFilters = {}): Promise<EngagementsResponse> {
  const params = new URLSearchParams();
  params.set('page', String(filters.page || 1));
  params.set('page_size', String(filters.pageSize || 50));
  if (filters.period) params.set('period', filters.period);
  if (filters.search) params.set('search', filters.search);
  if (filters.teamMember) params.set('team_member', filters.teamMember);
  if (filters.status) params.set('status', filters.status);
  appendSortParams(params, filters.sortBy);
  filters.departments?.forEach(d => params.append('departments', d));
  filters.intakeTypes?.forEach(t => params.append('intake_types', t));
  filters.projectTypes?.forEach(t => params.append('project_types', t));

  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements?${params}`);
  if (!response.ok) throw new Error('Failed to fetch engagements');
  return response.json();
}

/**
 * Fetches only the 4 metric cards data.
 * Endpoint: POST /api/client-interactions/metrics
 */
export async function getMetrics(filters: EngagementFilters = {}): Promise<DashboardMetrics> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: filters.period || '1Y',
      teamMember: filters.teamMember,
      departments: filters.departments || [],
      intakeTypes: filters.intakeTypes || [],
      projectTypes: filters.projectTypes || [],
      search: filters.search,
    }),
  });
  if (!response.ok) throw new Error('Failed to fetch metrics');
  return response.json();
}

/**
 * Fetches department breakdown for the horizontal bar chart.
 * Endpoint: POST /api/client-interactions/departments
 */
export async function getDepartmentBreakdown(filters: EngagementFilters = {}): Promise<DepartmentBreakdown> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: filters.period || '1Y',
      teamMember: filters.teamMember,
      departments: filters.departments || [],
      intakeTypes: filters.intakeTypes || [],
      projectTypes: filters.projectTypes || [],
      search: filters.search,
    }),
  });
  if (!response.ok) throw new Error('Failed to fetch department breakdown');
  return response.json();
}

/**
 * Fetches GitHub-style contribution heatmap data.
 * Endpoint: POST /api/client-interactions/contribution-data
 */
export async function getContributionData(filters: EngagementFilters = {}): Promise<ContributionDataResponse> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/contribution-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: filters.period || '1Y',
      teamMember: filters.teamMember,
      departments: filters.departments || [],
      intakeTypes: filters.intakeTypes || [],
      projectTypes: filters.projectTypes || [],
      search: filters.search,
    }),
  });
  if (!response.ok) throw new Error('Failed to fetch contribution data');
  return response.json();
}

/**
 * Slim engagement search for the "link previous interaction" picker.
 * Endpoint: GET /api/client-interactions/engagements/search
 */
export async function searchEngagementsForLink(opts: {
  q?: string;
  client?: string;
  excludeId?: number;
  id?: number;
  limit?: number;
}): Promise<EngagementLinkSummary[]> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.client) params.set('client', opts.client);
  if (opts.excludeId != null) params.set('excludeId', String(opts.excludeId));
  if (opts.id != null) params.set('id', String(opts.id));
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const response = await fetch(
    `${API_BASE_URL}/client-interactions/engagements/search?${params.toString()}`
  );
  if (!response.ok) throw new Error('Failed to search engagements');
  const data = await response.json();
  return data.results as EngagementLinkSummary[];
}

/**
 * Creates a new engagement record.
 * Endpoint: POST /api/client-interactions/engagements
 */
export async function createEngagement(engagement: Omit<Engagement, 'id'>): Promise<Engagement> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(engagement),
  });
  if (!response.ok) throw new Error('Failed to create engagement');
  return response.json();
}

/**
 * Updates an existing engagement with partial data (PATCH).
 * Endpoint: PATCH /api/client-interactions/engagements/:id
 */
export async function updateEngagement(
  id: number,
  updates: Partial<Omit<Engagement, 'id'>>
): Promise<Engagement> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (response.status === 409) {
    const data = await response.json();
    throw new ConflictError(data.error ?? 'This engagement was modified by someone else. Refresh and try again.');
  }
  if (!response.ok) throw new Error('Failed to update engagement');
  return response.json();
}

/**
 * Optimized endpoint for quick status changes.
 * Auto-sets dateFinished to today when status becomes "Completed".
 * Endpoint: PATCH /api/client-interactions/engagements/:id/status
 */
export async function updateEngagementStatus(
  id: number,
  status: string
): Promise<{ id: number; status: string; dateFinished: string }> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error('Failed to update status');
  return response.json();
}

/**
 * Optimized endpoint for quick NNA updates.
 * Endpoint: PATCH /api/client-interactions/engagements/:id/nna
 */
export async function updateEngagementNNA(
  id: number,
  nna: number | undefined
): Promise<{ id: number; nna: number | undefined }> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${id}/nna`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nna: nna ?? null }),
  });
  if (!response.ok) throw new Error('Failed to update NNA');
  return response.json();
}

/**
 * Fetches all note entries for an engagement, newest first.
 * Endpoint: GET /api/client-interactions/engagements/:id/notes
 */
export async function getEngagementNotes(id: number): Promise<NoteEntry[]> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${id}/notes`);
  if (!response.ok) throw new Error('Failed to fetch notes');
  const data = await response.json();
  return data.notes as NoteEntry[];
}

/**
 * Appends a new note entry to an engagement, attributed to the logged-in user.
 * Endpoint: POST /api/client-interactions/engagements/:id/notes
 */
export async function addEngagementNote(id: number, noteText: string): Promise<NoteEntry> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${id}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteText }),
  });
  if (!response.ok) throw new Error('Failed to add note');
  return response.json();
}

/**
 * Updates the text of an existing note. Only the note's author may edit it.
 * Endpoint: PATCH /api/client-interactions/engagements/:id/notes/:noteId
 */
export async function updateEngagementNote(engagementId: number, noteId: number, noteText: string): Promise<NoteEntry> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${engagementId}/notes/${noteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteText }),
  });
  if (!response.ok) throw new Error('Failed to update note');
  return response.json();
}

/**
 * Deletes a note. Only the note's author may delete it.
 * Endpoint: DELETE /api/client-interactions/engagements/:id/notes/:noteId
 */
export async function deleteEngagementNote(engagementId: number, noteId: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${engagementId}/notes/${noteId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete note');
}

/**
 * Updates the project filepath for an engagement. Pass null to clear it.
 * Endpoint: PATCH /api/client-interactions/engagements/:id/filepath
 */
export async function updateEngagementFilepath(id: number, filepath: string | null): Promise<Engagement> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${id}/filepath`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filepath }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update filepath');
  }
  return response.json();
}

/**
 * Deletes an engagement record permanently.
 * Endpoint: DELETE /api/client-interactions/engagements/:id
 */
export async function deleteEngagement(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/engagements/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete engagement');
}

/**
 * Fetches the distinct list of internal clients (name + dept) from existing engagements.
 * Endpoint: GET /api/client-interactions/internal-clients
 */
export async function getInternalClients(): Promise<InternalClientOption[]> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/internal-clients`);
  if (!response.ok) throw new Error('Failed to fetch internal clients');
  const data = await response.json();
  return data.clients as InternalClientOption[];
}

// =============================================================================
// CLIENT REGISTRY (external clients, keyed by CRN)
// =============================================================================

/** How CRNs are sourced — drives whether the form shows a CRN input. */
export interface CrnConfigResponse {
  autoGenerate: boolean;
  prefix: string;
}

/** Thrown when registering/renaming a client hits a duplicate CRN or name. */
export class ClientConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientConflictError';
  }
}

/**
 * Searches the client registry by canonical name OR CRN.
 * Endpoint: GET /api/client-interactions/clients
 */
export async function getClients(q?: string, limit = 50): Promise<Client[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  const response = await fetch(`${API_BASE_URL}/client-interactions/clients?${params}`);
  if (!response.ok) throw new Error('Failed to fetch clients');
  const data = await response.json();
  return data.clients as Client[];
}

/**
 * Registers a new client. In manual mode `crn` is required; in auto mode it is ignored.
 * Endpoint: POST /api/client-interactions/clients
 */
export async function registerClient(name: string, crn?: string): Promise<Client> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/clients`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, crn }),
  });
  if (response.status === 409) {
    const data = await response.json().catch(() => ({}));
    throw new ClientConflictError(data.error ?? 'A client with that CRN or name already exists.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to register client');
  }
  return response.json();
}

/**
 * Updates a client's canonical name and/or its CRN (admin only). Changing the CRN
 * cascades to every engagement referencing it. Pass the client's CURRENT crn in the
 * path; supply a new `crn` in updates to change it.
 * Endpoint: PATCH /api/client-interactions/clients/:crn
 */
export async function updateClient(crn: string, updates: { name?: string; crn?: string }): Promise<Client> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/clients/${encodeURIComponent(crn)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (response.status === 409) {
    const data = await response.json().catch(() => ({}));
    throw new ClientConflictError(data.error ?? 'Another client already uses that name or CRN.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to update client');
  }
  return response.json();
}

/**
 * Returns the CRN sourcing mode so the UI knows whether to collect a CRN.
 * Endpoint: GET /api/client-interactions/clients/config
 */
export async function getCrnConfig(): Promise<CrnConfigResponse> {
  const response = await fetch(`${API_BASE_URL}/client-interactions/clients/config`);
  if (!response.ok) throw new Error('Failed to fetch CRN config');
  return response.json();
}

/**
 * Exports filtered engagements as a CSV file.
 * Endpoint: GET /api/client-interactions/export
 */
export async function exportEngagements(filters: EngagementFilters = {}): Promise<Blob> {
  const params = new URLSearchParams();
  if (filters.period) params.set('period', filters.period);
  if (filters.search) params.set('search', filters.search);
  if (filters.teamMember) params.set('team_member', filters.teamMember);
  if (filters.status) params.set('status', filters.status);
  filters.departments?.forEach(d => params.append('departments', d));
  filters.intakeTypes?.forEach(t => params.append('intake_types', t));
  filters.projectTypes?.forEach(t => params.append('project_types', t));

  const response = await fetch(`${API_BASE_URL}/client-interactions/export?${params}`);
  if (!response.ok) throw new Error('Failed to export engagements');
  return response.blob();
}
