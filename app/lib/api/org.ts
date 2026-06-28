/**
 * Client-side API for the editable Teams / Offices lists.
 * Backed by the route handlers under /api/teams and /api/offices.
 */

export interface OrgItem {
  id: string;
  name: string;
  /** Users + team members currently assigned — drives the delete-button guard. */
  assignedCount: number;
}

/** Thrown when a create/rename/delete is rejected (duplicate name, still in use, etc.). */
export class OrgConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgConflictError';
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new OrgConflictError(data.error ?? fallback);
}

// ── Teams ──────────────────────────────────────────────────────────────────

export async function getTeams(): Promise<OrgItem[]> {
  const res = await fetch('/api/teams');
  if (!res.ok) throw new Error('Failed to load teams.');
  return res.json();
}

export async function createTeam(name: string): Promise<OrgItem> {
  const res = await fetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return readError(res, 'Failed to add team.');
  return res.json();
}

export async function renameTeam(id: string, name: string): Promise<OrgItem> {
  const res = await fetch(`/api/teams/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return readError(res, 'Failed to rename team.');
  return res.json();
}

export async function deleteTeam(id: string): Promise<void> {
  const res = await fetch(`/api/teams/${id}`, { method: 'DELETE' });
  if (!res.ok) await readError(res, 'Failed to delete team.');
}

// ── Offices ──────────────────────────────────────────────────────────────────

export async function getOffices(): Promise<OrgItem[]> {
  const res = await fetch('/api/offices');
  if (!res.ok) throw new Error('Failed to load offices.');
  return res.json();
}

export async function createOffice(name: string): Promise<OrgItem> {
  const res = await fetch('/api/offices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return readError(res, 'Failed to add office.');
  return res.json();
}

export async function renameOffice(id: string, name: string): Promise<OrgItem> {
  const res = await fetch(`/api/offices/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return readError(res, 'Failed to rename office.');
  return res.json();
}

export async function deleteOffice(id: string): Promise<void> {
  const res = await fetch(`/api/offices/${id}`, { method: 'DELETE' });
  if (!res.ok) await readError(res, 'Failed to delete office.');
}
