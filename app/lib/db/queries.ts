import { toDisplayDate } from './dateUtils';
import { getPeriodStartISO } from './dateUtils';
import { queryUsers } from './users';
import type { Engagement } from '../types/engagements';
import type { EngagementFilters } from '../api/client-interactions';

// Internal-only extension of EngagementFilters: when teamMember is an Office
// pseudo-value, callers must populate this field with the live member-name list
// (queried from the team_members table) before calling buildFilterClause.
// See resolveOfficeMembers() below.
export interface InternalEngagementFilters extends EngagementFilters {
  _officeMembers?: string[];
}

/**
 * Resolves an Office filter (any managed office name, e.g. "Charlotte") to the
 * live list of member display names. team_members lives in users.sqlite, so we
 * can't JOIN to it from the engagements connection — caller must pre-resolve and
 * pass the results to buildFilterClause via _officeMembers.
 *
 * A non-default teamMember is treated as an office only if it matches a row in
 * the managed `offices` table; otherwise it's an individual member name and is
 * left untouched (buildFilterClause matches it directly). Setting _officeMembers
 * — even to an empty array — is the signal to buildFilterClause that this is an
 * office filter.
 *
 * Cross-office surfacing falls out of the OR-based match in buildFilterClause:
 * an engagement is shown in an office's filter as long as ANY assigned team
 * member belongs to that office.
 */
export async function resolveOfficeMembers(
  filters: EngagementFilters
): Promise<InternalEngagementFilters> {
  const teamMember = filters.teamMember;
  if (!teamMember || teamMember === 'All Team Members' || teamMember === 'All Teams') {
    return filters;
  }
  const isOffice = await queryUsers(
    `SELECT 1 FROM offices WHERE name = ? COLLATE NOCASE LIMIT 1`,
    [teamMember]
  );
  if (isOffice.length === 0) {
    return filters; // an individual member name, not an office
  }
  const rows = await queryUsers<{ display_name: string }>(
    `SELECT display_name FROM team_members WHERE office = ? AND status = 'active'`,
    [teamMember]
  );
  return { ...filters, _officeMembers: rows.map(r => r.display_name) };
}

// Shared JOIN that resolves an engagement's external client from the registry.
// Callers that reference client name/crn (search, sort, list, export) alias the
// engagements table as `e` and append this so `c.name` / `c.crn` are available.
export const CLIENT_JOIN = 'LEFT JOIN clients c ON c.crn = e.client_crn';

// Allowlist for ORDER BY columns to prevent SQL injection.
// `teamMembers` sorts by the first member's name since the column is a JSON array.
export const SORT_COLUMN_MAP: Record<string, string> = {
  dateStarted: 'date_started',
  dateFinished: 'date_finished',
  externalClient: 'c.name',
  clientCrn: 'e.client_crn',
  internalClient: 'internal_client_name',
  status: 'status',
  department: 'department',
  type: 'type',
  intakeType: 'intake_type',
  nna: 'nna',
  portfolioLogged: 'portfolio_logged',
  teamMembers: `json_extract(team_members, '$[0]')`,
};

export interface ServerConstraints {
  team?: string;
}

/**
 * Team-scope SQL for a team-constrained user.
 *
 * An engagement with `team IS NULL` is UNASSIGNED — it belongs to no team yet and
 * sits in a global inbox every user can see and claim (see the /assign route).
 * Automation writes land here: a scheduled job has no idea who should own a new
 * interaction, so a human picks it up afterwards. Once claimed, `team` is set and
 * normal team isolation applies from then on.
 *
 * Returns an empty clause for unconstrained callers (admins / read-only teams),
 * matching the `if (sc.team)` shape the routes used before.
 *
 * NOTE: kpi-aggregations.ts deliberately does NOT use this — unassigned work is
 * nobody's work yet and must not inflate every team's KPIs at once.
 */
export function teamScopeClause(
  serverConstraints: ServerConstraints,
  tableAlias = ''
): { clause: string; params: unknown[] } {
  if (!serverConstraints.team) return { clause: '', params: [] };
  const col = tableAlias ? `${tableAlias}.team` : 'team';
  return { clause: `AND (${col} = ? OR ${col} IS NULL)`, params: [serverConstraints.team] };
}

/**
 * Builds a parameterized WHERE clause from EngagementFilters.
 * All user-supplied values go through params — no string interpolation of user data.
 * serverConstraints are enforced server-side and cannot be overridden by clients.
 */
export function buildFilterClause(
  filters: InternalEngagementFilters,
  tableAlias = '',
  serverConstraints: ServerConstraints = {}
): { whereClause: string; params: unknown[] } {
  const col = (c: string) => (tableAlias ? `${tableAlias}.${c}` : c);
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Server-enforced team isolation — applied before all client filters. Rows with
  // team IS NULL are unassigned and visible to everyone (see teamScopeClause).
  if (serverConstraints.team) {
    conditions.push(`(${col('team')} = ? OR ${col('team')} IS NULL)`);
    params.push(serverConstraints.team);
  }

  // Period filter: applies to date_started
  if (filters.period) {
    const startISO = getPeriodStartISO(filters.period);
    if (startISO) {
      conditions.push(`${col('date_started')} >= ?`);
      params.push(startISO);
    }
  }

  // Department filter (multi-select)
  if (filters.departments && filters.departments.length > 0) {
    const placeholders = filters.departments.map(() => '?').join(', ');
    conditions.push(`${col('internal_client_dept')} IN (${placeholders})`);
    params.push(...filters.departments);
  }

  // Intake type filter (multi-select)
  if (filters.intakeTypes && filters.intakeTypes.length > 0) {
    const placeholders = filters.intakeTypes.map(() => '?').join(', ');
    conditions.push(`${col('intake_type')} IN (${placeholders})`);
    params.push(...filters.intakeTypes);
  }

  // Project type filter (multi-select)
  if (filters.projectTypes && filters.projectTypes.length > 0) {
    const placeholders = filters.projectTypes.map(() => '?').join(', ');
    conditions.push(`${col('type')} IN (${placeholders})`);
    params.push(...filters.projectTypes);
  }

  // Status filter
  if (filters.status) {
    conditions.push(`${col('status')} = ?`);
    params.push(filters.status);
  }

  // Team member filter: check if the engagement's JSON team_members array contains
  // any of the requested names. json_each() expands the JSON array into rows so
  // EXISTS can test for an exact element match.
  // - 'All Teams' is the cross-team aggregate scope (admin/Leadership/Guest only)
  //   and 'All Team Members' is the no-filter default — both pass through.
  // - An office name is a pseudo-value: resolveOfficeMembers() expands it to a
  //   live member-name list and sets _officeMembers (its presence flags an office
  //   filter). An engagement matches an office's filter as long as ANY assigned
  //   team member belongs to that office, so a project staffed across offices
  //   shows up in BOTH offices' results.
  if (filters.teamMember && filters.teamMember !== 'All Team Members' && filters.teamMember !== 'All Teams') {
    const isOffice = filters._officeMembers !== undefined;
    const members = isOffice ? filters._officeMembers ?? [] : [filters.teamMember];

    if (members.length === 0) {
      // Office had no active members — match nothing rather than fall back to
      // an unfiltered query.
      conditions.push('1=0');
    } else {
      const memberConditions = members.map(
        () => `EXISTS (SELECT 1 FROM json_each(${col('team_members')}) WHERE value = ?)`,
      );
      members.forEach(m => params.push(m));
      conditions.push(`(${memberConditions.join(' OR ')})`);
    }
  }

  // Full-text search across key string columns. The external client is resolved
  // from the registry, so callers must include CLIENT_JOIN (alias `c`) and alias
  // engagements as `e` — searchable by canonical name AND CRN.
  if (filters.search && filters.search.trim()) {
    const s = `%${filters.search.toLowerCase()}%`;
    conditions.push(`(
      lower(c.name) LIKE ?
      OR lower(${col('client_crn')}) LIKE ?
      OR lower(${col('internal_client_name')}) LIKE ?
      OR lower(${col('intake_type')}) LIKE ?
      OR lower(${col('type')}) LIKE ?
      OR lower(${col('department')}) LIKE ?
      OR lower(${col('project_id')}) LIKE ?
    )`);
    params.push(s, s, s, s, s, s, s);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

/**
 * Maps a raw SQLite row object to the typed Engagement interface.
 * Parses JSON array columns and converts dates to display format.
 */
export function rowToEngagement(row: Record<string, unknown>): Engagement {
  return {
    id: Number(row.id),
    clientCrn: (row.client_crn as string | null) ?? '',
    crnPending: Boolean(row.client_crn_pending),
    // Canonical name resolved via CLIENT_JOIN (aliased client_name); never the
    // retired free-text external_client column.
    externalClient: (row.client_name as string | null) ?? '',
    internalClient: {
      name: row.internal_client_name as string,
      clientDept: row.internal_client_dept as string,
    },
    intakeType: row.intake_type as string,
    adHocChannel: (row.ad_hoc_channel as string | undefined) as import('../types/engagements').AdHocChannel | undefined,
    type: row.type as string,
    projectId: (row.project_id as string | null) ?? null,
    teamMembers: JSON.parse((row.team_members as string) || '[]') as string[],
    office: (row.office as string | null) ?? null,
    department: row.department as string,
    dateStarted: toDisplayDate(row.date_started as string),
    dateFinished: toDisplayDate(row.date_finished as string | null),
    status: row.status as string,
    portfolioLogged: Boolean(row.portfolio_logged),
    portfolioUnchanged: Boolean(row.portfolio_unchanged),
    portfolio: row.portfolio
      ? JSON.parse(row.portfolio as string)
      : undefined,
    nna: row.nna != null ? Number(row.nna) : undefined,
    notes: (row.notes as string | undefined) || undefined,
    noteCount: Number(row.note_count ?? 0),
    version: Number(row.version ?? 1),
    tickersMentioned: row.tickers_mentioned
      ? (JSON.parse(row.tickers_mentioned as string) as string[])
      : undefined,
    createdById: (row.created_by_id as string | undefined) || undefined,
    createdByName: (row.created_by_name as string | undefined) || undefined,
    linkedFromId: row.linked_from_id != null ? Number(row.linked_from_id) : null,
    filepath: (row.filepath as string | null) ?? null,
  };
}
