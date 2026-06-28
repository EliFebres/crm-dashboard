export const READ_ONLY_TEAMS = ['Leadership', 'Guest'] as const;
export type ReadOnlyTeam = typeof READ_ONLY_TEAMS[number];

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  department: 'Default';
  team:
    | 'Default Team'
    | 'Equity Specialist'
    | 'Fixed Income Specialist'
    | 'Leadership'
    | 'Guest';
  office: 'Charlotte' | 'Austin' | 'Santa Monica' | 'UK' | 'Sydney';
  role: 'user' | 'admin';
  status: 'pending' | 'active' | 'inactive';
  createdAt: string;
  approvedAt: string | null;
  approvedById: string | null;
}

export function isReadOnlyUser(user: Pick<User, 'team'> | null | undefined): boolean {
  if (!user) return false;
  return (READ_ONLY_TEAMS as readonly string[]).includes(user.team);
}

export function canUserEditEngagement(
  user: Pick<User, 'firstName' | 'lastName' | 'role' | 'team'> | null | undefined,
  teamMembers: string[]
): boolean {
  if (!user || isReadOnlyUser(user)) return false;
  if (user.role === 'admin') return true;
  return teamMembers.includes(toDisplayName(user.firstName, user.lastName));
}

/**
 * Converts a first/last name pair to the display format used in the team_members
 * table and in engagement team_members JSON arrays. e.g. "Eli" + "Febres" → "Eli F."
 */
export function toDisplayName(firstName: string, lastName: string): string {
  if (!lastName || lastName.length === 0) return firstName;
  return `${firstName} ${lastName[0]}.`;
}

export interface TeamMember {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  team: User['team'];
  office: User['office'];
  status: 'active' | 'inactive';
  userId: string | null;
  createdAt: string;
}

export function rowToTeamMember(row: Record<string, unknown>): TeamMember {
  return {
    id: row.id as string,
    displayName: row.display_name as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    team: row.team as User['team'],
    office: row.office as User['office'],
    status: row.status as TeamMember['status'],
    userId: row.user_id as string | null,
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
  };
}

/** Map a raw DB row (snake_case) to a User object */
export function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    title: row.title as string,
    department: (row.department as string ?? 'Default') as 'Default',
    team: row.team as User['team'],
    office: row.office as User['office'],
    role: row.role as User['role'],
    status: row.status as User['status'],
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    approvedById: row.approved_by_id as string | null,
  };
}
