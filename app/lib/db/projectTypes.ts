/**
 * Data layer for the managed project types.
 *
 * The project-type NAME is denormalized onto engagements.type, so a rename must
 * cascade into engagements — atomically in one transaction (mirrors departments).
 *
 * Project types are a flat global list (not scoped per intake type). One built-in,
 * `PCR`, carries the stable role `pcr`; metric SQL that excludes PCR binds to that
 * role, not the display name, so it can be renamed freely. Role-bearing rows can't
 * be DELETED. Custom project types (role = NULL) add/rename/delete like departments.
 */
import { query, executeTransaction } from './index';
import { randomUUID } from 'crypto';

export interface ProjectTypeRow {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Stable key for built-ins (`pcr`); null for custom types. */
  role: string | null;
  /** Engagements using this project type — drives the delete guard. */
  assignedCount: number;
}

/** Carries an HTTP status so route handlers can translate it to a response. */
export class ProjectTypeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ProjectTypeError';
  }
}

const ROLE_FALLBACK: Record<string, string> = { pcr: 'PCR' };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeColor(raw: unknown, fallback = '#71717a'): string {
  if (typeof raw !== 'string') return fallback;
  const c = raw.trim();
  return HEX_COLOR.test(c) ? c.toLowerCase() : fallback;
}

/** List project types ordered by sort_order then name, each with its usage count. */
export async function listProjectTypes(): Promise<ProjectTypeRow[]> {
  const rows = await query<{ id: string; name: string; color: string; sort_order: number; role: string | null; assigned_count: number }>(
    `SELECT t.id, t.name, t.color, t.sort_order, t.role,
            (SELECT COUNT(*) FROM engagements e WHERE e.type = t.name) AS assigned_count
       FROM project_types t
      ORDER BY t.sort_order, t.name COLLATE NOCASE`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    sortOrder: Number(r.sort_order),
    role: r.role ?? null,
    assignedCount: Number(r.assigned_count),
  }));
}

/** Plain list of project-type names (for filter options / form dropdowns). */
export async function listProjectTypeNames(): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT name FROM project_types ORDER BY sort_order, name COLLATE NOCASE`
  );
  return rows.map(r => r.name);
}

/** Name → color map (for chart coloring). */
export async function projectTypeColorMap(): Promise<Record<string, string>> {
  const rows = await query<{ name: string; color: string }>(
    `SELECT name, color FROM project_types ORDER BY sort_order, name COLLATE NOCASE`
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.name] = r.color;
  return map;
}

/**
 * Current display name for a built-in role (e.g. 'pcr' → 'PCR', or whatever an
 * admin renamed it to). Lets metric SQL reference the role instead of a hardcoded
 * literal so a rename never breaks a KPI. Falls back to the canonical literal.
 */
export async function projectNameForRole(role: string): Promise<string> {
  const rows = await query<{ name: string }>(`SELECT name FROM project_types WHERE role = ? LIMIT 1`, [role]);
  return rows[0]?.name ?? ROLE_FALLBACK[role] ?? role;
}

/** Create a custom project type. Throws ProjectTypeError(409) on a dup name. */
export async function createProjectType(rawName: string, rawColor?: unknown): Promise<ProjectTypeRow> {
  const name = rawName.trim();
  if (!name) throw new ProjectTypeError(400, 'A project type name is required.');
  const color = normalizeColor(rawColor);

  const dupe = await query(`SELECT 1 FROM project_types WHERE name = ? COLLATE NOCASE`, [name]);
  if (dupe.length > 0) throw new ProjectTypeError(409, `A project type named "${name}" already exists.`);

  const id = randomUUID();
  const maxRow = await query<{ m: number }>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM project_types`);
  const sortOrder = Number(maxRow[0]?.m ?? 0) + 1;
  await executeTransaction((tx) => {
    tx.run(`INSERT INTO project_types (id, name, color, sort_order, role) VALUES (?, ?, ?, ?, NULL)`, [id, name, color, sortOrder]);
  });
  return { id, name, color, sortOrder, role: null, assignedCount: 0 };
}

/**
 * Update a project type's name and/or color. A name change cascades into
 * engagements.type (including for the built-in — the role is preserved). Atomic.
 */
export async function updateProjectType(
  id: string,
  patch: { name?: string; color?: unknown; sortOrder?: number }
): Promise<ProjectTypeRow> {
  return executeTransaction<ProjectTypeRow>((tx) => {
    const current = tx.get<{ name: string; color: string; sort_order: number; role: string | null }>(
      `SELECT name, color, sort_order, role FROM project_types WHERE id = ?`, [id]
    );
    if (!current) throw new ProjectTypeError(404, 'That project type no longer exists.');

    const nextName = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name;
    const nextColor = patch.color === undefined ? current.color : normalizeColor(patch.color, current.color);
    const nextOrder = typeof patch.sortOrder === 'number' ? patch.sortOrder : current.sort_order;

    if (nextName !== current.name) {
      const dupe = tx.get(`SELECT 1 FROM project_types WHERE name = ? COLLATE NOCASE AND id != ?`, [nextName, id]);
      if (dupe) throw new ProjectTypeError(409, `A project type named "${nextName}" already exists.`);
    }

    tx.run(
      `UPDATE project_types SET name = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextName, nextColor, nextOrder, id]
    );

    if (nextName !== current.name) {
      tx.run(`UPDATE engagements SET type = ? WHERE type = ?`, [nextName, current.name]);
    }

    const assigned = tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM engagements WHERE type = ?`, [nextName])?.c ?? 0;
    return { id, name: nextName, color: nextColor, sortOrder: Number(nextOrder), role: current.role ?? null, assignedCount: Number(assigned) };
  });
}

/**
 * Delete a project type. Refuses (409) for a built-in (role != NULL) or while any
 * engagement still uses it, so nothing is orphaned. Returns the deleted name.
 */
export async function deleteProjectType(id: string): Promise<string> {
  return executeTransaction<string>((tx) => {
    const current = tx.get<{ name: string; role: string | null }>(`SELECT name, role FROM project_types WHERE id = ?`, [id]);
    if (!current) throw new ProjectTypeError(404, 'That project type no longer exists.');

    if (current.role) {
      throw new ProjectTypeError(409, `Can't delete "${current.name}" — it's a built-in project type. You can rename it, but not remove it.`);
    }

    const assigned = tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM engagements WHERE type = ?`, [current.name])?.c ?? 0;
    if (assigned > 0) {
      throw new ProjectTypeError(409, `Can't delete — ${assigned} engagement(s) still use this project type. Reassign them first.`);
    }

    tx.run(`DELETE FROM project_types WHERE id = ?`, [id]);
    return current.name;
  });
}
