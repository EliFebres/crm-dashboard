/**
 * Client-side API for the managed Project Types and Intake Types registries.
 * Backed by /api/project-types and /api/intake-types. Mirrors app/lib/api/internal-clients.ts.
 */
import { RegistryConflictError } from '@/app/lib/api/internal-clients';

export { RegistryConflictError };

export interface ProjectTypeItem {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Stable key for built-ins (`pcr`); null for custom types. Built-ins can't be deleted. */
  role: string | null;
  /** Engagements using this project type — drives the delete guard. */
  assignedCount: number;
}

export interface IntakeTypeItem {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Stable key for built-ins (`irq`/`serf`/`ad_hoc`); null for custom types. Built-ins can't be deleted. */
  role: string | null;
  /** Engagements using this intake type — drives the delete guard. */
  assignedCount: number;
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new RegistryConflictError(data.error ?? fallback);
}

// ── Project Types ─────────────────────────────────────────────────────────────

export async function getProjectTypes(): Promise<ProjectTypeItem[]> {
  const res = await fetch('/api/project-types');
  if (!res.ok) throw new Error('Failed to load project types.');
  const data = await res.json();
  return data.projectTypes as ProjectTypeItem[];
}

export async function createProjectType(name: string, color?: string): Promise<ProjectTypeItem> {
  const res = await fetch('/api/project-types', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) return readError(res, 'Failed to add project type.');
  return res.json();
}

export async function updateProjectType(
  id: string,
  patch: { name?: string; color?: string; sortOrder?: number }
): Promise<ProjectTypeItem> {
  const res = await fetch(`/api/project-types/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return readError(res, 'Failed to update project type.');
  return res.json();
}

export async function deleteProjectType(id: string): Promise<void> {
  const res = await fetch(`/api/project-types/${id}`, { method: 'DELETE' });
  if (!res.ok) await readError(res, 'Failed to delete project type.');
}

/** Persist a new display order — `ids` in the desired order. */
export async function reorderProjectTypes(ids: string[]): Promise<void> {
  const res = await fetch('/api/project-types/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) await readError(res, 'Failed to reorder project types.');
}

// ── Intake Types ──────────────────────────────────────────────────────────────

export async function getIntakeTypes(): Promise<IntakeTypeItem[]> {
  const res = await fetch('/api/intake-types');
  if (!res.ok) throw new Error('Failed to load intake types.');
  const data = await res.json();
  return data.intakeTypes as IntakeTypeItem[];
}

export async function createIntakeType(name: string, color?: string): Promise<IntakeTypeItem> {
  const res = await fetch('/api/intake-types', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) return readError(res, 'Failed to add intake type.');
  return res.json();
}

export async function updateIntakeType(
  id: string,
  patch: { name?: string; color?: string; sortOrder?: number }
): Promise<IntakeTypeItem> {
  const res = await fetch(`/api/intake-types/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return readError(res, 'Failed to update intake type.');
  return res.json();
}

export async function deleteIntakeType(id: string): Promise<void> {
  const res = await fetch(`/api/intake-types/${id}`, { method: 'DELETE' });
  if (!res.ok) await readError(res, 'Failed to delete intake type.');
}

/** Persist a new display order — `ids` in the desired order. */
export async function reorderIntakeTypes(ids: string[]): Promise<void> {
  const res = await fetch('/api/intake-types/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) await readError(res, 'Failed to reorder intake types.');
}
