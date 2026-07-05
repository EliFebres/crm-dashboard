/**
 * Client-side API for the editable rank Titles list.
 * Backed by the route handlers under /api/titles.
 */

export interface TitleItem {
  id: string;
  name: string;
  /** Admin-defined rank. */
  sortOrder: number;
  /** Users + team members currently holding this title — drives the delete-button guard. */
  assignedCount: number;
}

/** Thrown when a create/rename/delete is rejected (duplicate name, still in use, etc.). */
export class TitleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TitleConflictError';
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new TitleConflictError(data.error ?? fallback);
}

export async function getTitles(): Promise<TitleItem[]> {
  const res = await fetch('/api/titles');
  if (!res.ok) throw new Error('Failed to load titles.');
  return res.json();
}

export async function createTitle(name: string): Promise<TitleItem> {
  const res = await fetch('/api/titles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return readError(res, 'Failed to add title.');
  return res.json();
}

export async function renameTitle(id: string, name: string): Promise<TitleItem> {
  const res = await fetch(`/api/titles/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) return readError(res, 'Failed to rename title.');
  return res.json();
}

export async function deleteTitle(id: string): Promise<void> {
  const res = await fetch(`/api/titles/${id}`, { method: 'DELETE' });
  if (!res.ok) await readError(res, 'Failed to delete title.');
}

/** Persist a new rank order — `ids` in the desired order. */
export async function reorderTitles(ids: string[]): Promise<void> {
  const res = await fetch('/api/titles/reorder', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) await readError(res, 'Failed to reorder titles.');
}
