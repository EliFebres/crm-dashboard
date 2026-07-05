/**
 * Client-side API for the managed Departments and Internal Clients registries.
 * Backed by /api/departments and /api/internal-clients. Mirrors app/lib/api/org.ts.
 */

export interface DepartmentItem {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Engagements + internal clients using this department — drives the delete guard. */
  assignedCount: number;
}

export interface InternalClientItem {
  id: string;
  name: string;
  department: string;
  /** Engagements referencing this internal client — drives the delete guard. */
  assignedCount: number;
}

/** Thrown when a create/rename/delete is rejected (duplicate, still in use, etc.). */
export class RegistryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryConflictError';
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new RegistryConflictError(data.error ?? fallback);
}

// ── Departments ──────────────────────────────────────────────────────────────

export async function getDepartments(): Promise<DepartmentItem[]> {
  const res = await fetch('/api/departments');
  if (!res.ok) throw new Error('Failed to load departments.');
  const data = await res.json();
  return data.departments as DepartmentItem[];
}

export async function createDepartment(name: string, color?: string): Promise<DepartmentItem> {
  const res = await fetch('/api/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) return readError(res, 'Failed to add department.');
  return res.json();
}

export async function updateDepartment(
  id: string,
  patch: { name?: string; color?: string; sortOrder?: number }
): Promise<DepartmentItem> {
  const res = await fetch(`/api/departments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return readError(res, 'Failed to update department.');
  return res.json();
}

export async function deleteDepartment(id: string): Promise<void> {
  const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' });
  if (!res.ok) await readError(res, 'Failed to delete department.');
}

// ── Internal Clients ─────────────────────────────────────────────────────────

export async function listInternalClients(): Promise<InternalClientItem[]> {
  const res = await fetch('/api/internal-clients');
  if (!res.ok) throw new Error('Failed to load internal clients.');
  const data = await res.json();
  return data.internalClients as InternalClientItem[];
}

export async function createInternalClient(name: string, department: string): Promise<InternalClientItem> {
  const res = await fetch('/api/internal-clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, department }),
  });
  if (!res.ok) return readError(res, 'Failed to add internal client.');
  return res.json();
}

export async function updateInternalClient(
  id: string,
  patch: { name?: string; department?: string }
): Promise<InternalClientItem> {
  const res = await fetch(`/api/internal-clients/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return readError(res, 'Failed to update internal client.');
  return res.json();
}

export async function deleteInternalClient(id: string): Promise<void> {
  const res = await fetch(`/api/internal-clients/${id}`, { method: 'DELETE' });
  if (!res.ok) await readError(res, 'Failed to delete internal client.');
}
