/**
 * Data layer for the managed internal-client departments.
 *
 * The department name is denormalized onto `engagements.internal_client_dept` and
 * `internal_clients.department`, so a rename must cascade into both — atomically in
 * one transaction. This mirrors the `clients.crn` → `engagements.client_crn` cascade
 * and, unlike teams/offices, lives in engagements.sqlite so the cascade is single-DB.
 */
import { query, executeTransaction } from './index';
import { randomUUID } from 'crypto';

export interface DepartmentRow {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Engagements + internal clients using this department — drives the delete guard. */
  assignedCount: number;
}

/** Carries an HTTP status so route handlers can translate it to a response. */
export class DeptError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'DeptError';
  }
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeColor(raw: unknown, fallback = '#71717a'): string {
  if (typeof raw !== 'string') return fallback;
  const c = raw.trim();
  return HEX_COLOR.test(c) ? c.toLowerCase() : fallback;
}

/** List departments ordered by sort_order then name, each with its usage count. */
export async function listDepartments(): Promise<DepartmentRow[]> {
  const rows = await query<{ id: string; name: string; color: string; sort_order: number; assigned_count: number }>(
    `SELECT d.id, d.name, d.color, d.sort_order,
            (SELECT COUNT(*) FROM engagements e      WHERE e.internal_client_dept = d.name)
          + (SELECT COUNT(*) FROM internal_clients c WHERE c.department = d.name) AS assigned_count
       FROM departments d
      ORDER BY d.sort_order, d.name COLLATE NOCASE`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    color: r.color,
    sortOrder: Number(r.sort_order),
    assignedCount: Number(r.assigned_count),
  }));
}

/** Plain list of department names (for filter options / form dropdowns). */
export async function listDepartmentNames(): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT name FROM departments ORDER BY sort_order, name COLLATE NOCASE`
  );
  return rows.map(r => r.name);
}

/** Name → color map (for the department breakdown chart). */
export async function departmentColorMap(): Promise<Record<string, string>> {
  const rows = await query<{ name: string; color: string }>(
    `SELECT name, color FROM departments ORDER BY sort_order, name COLLATE NOCASE`
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.name] = r.color;
  return map;
}

/** Create a department. Throws DeptError(409) on a case-insensitive duplicate. */
export async function createDepartment(rawName: string, rawColor?: unknown): Promise<DepartmentRow> {
  const name = rawName.trim();
  if (!name) throw new DeptError(400, 'A department name is required.');
  const color = normalizeColor(rawColor);

  const dupe = await query(`SELECT 1 FROM departments WHERE name = ? COLLATE NOCASE`, [name]);
  if (dupe.length > 0) throw new DeptError(409, `A department named "${name}" already exists.`);

  const id = randomUUID();
  // New departments sort after the seeded set but keep insertion order among peers.
  const maxRow = await query<{ m: number }>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM departments`);
  const sortOrder = Number(maxRow[0]?.m ?? 0) + 1;
  await executeTransaction((tx) => {
    tx.run(`INSERT INTO departments (id, name, color, sort_order) VALUES (?, ?, ?, ?)`, [id, name, color, sortOrder]);
  });
  return { id, name, color, sortOrder, assignedCount: 0 };
}

/**
 * Update a department's name and/or color. A name change cascades into
 * engagements.internal_client_dept and internal_clients.department. Atomic.
 */
export async function updateDepartment(
  id: string,
  patch: { name?: string; color?: unknown; sortOrder?: number }
): Promise<DepartmentRow> {
  return executeTransaction<DepartmentRow>((tx) => {
    const current = tx.get<{ name: string; color: string; sort_order: number }>(
      `SELECT name, color, sort_order FROM departments WHERE id = ?`, [id]
    );
    if (!current) throw new DeptError(404, 'That department no longer exists.');

    const nextName = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name;
    const nextColor = patch.color === undefined ? current.color : normalizeColor(patch.color, current.color);
    const nextOrder = typeof patch.sortOrder === 'number' ? patch.sortOrder : current.sort_order;

    if (nextName !== current.name) {
      const dupe = tx.get(`SELECT 1 FROM departments WHERE name = ? COLLATE NOCASE AND id != ?`, [nextName, id]);
      if (dupe) throw new DeptError(409, `A department named "${nextName}" already exists.`);
    }

    tx.run(
      `UPDATE departments SET name = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextName, nextColor, nextOrder, id]
    );

    if (nextName !== current.name) {
      tx.run(`UPDATE engagements      SET internal_client_dept = ? WHERE internal_client_dept = ?`, [nextName, current.name]);
      tx.run(`UPDATE internal_clients SET department           = ? WHERE department           = ?`, [nextName, current.name]);
    }

    const assigned =
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM engagements      WHERE internal_client_dept = ?`, [nextName])?.c ?? 0) +
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM internal_clients WHERE department           = ?`, [nextName])?.c ?? 0);

    return { id, name: nextName, color: nextColor, sortOrder: Number(nextOrder), assignedCount: Number(assigned) };
  });
}

/**
 * Delete a department. Refuses (DeptError 409) while any engagement or internal
 * client still uses it, so nothing is orphaned. Returns the deleted name.
 */
export async function deleteDepartment(id: string): Promise<string> {
  return executeTransaction<string>((tx) => {
    const current = tx.get<{ name: string }>(`SELECT name FROM departments WHERE id = ?`, [id]);
    if (!current) throw new DeptError(404, 'That department no longer exists.');

    const assigned =
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM engagements      WHERE internal_client_dept = ?`, [current.name])?.c ?? 0) +
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM internal_clients WHERE department           = ?`, [current.name])?.c ?? 0);
    if (assigned > 0) {
      throw new DeptError(
        409,
        `Can't delete — ${assigned} engagement(s)/internal client(s) still use this department. Reassign them first.`
      );
    }

    tx.run(`DELETE FROM departments WHERE id = ?`, [id]);
    return current.name;
  });
}

/** True if `name` is a managed department (used to validate assignments). */
export async function departmentExists(name: string): Promise<boolean> {
  const rows = await query(`SELECT 1 FROM departments WHERE name = ? COLLATE NOCASE`, [name]);
  return rows.length > 0;
}
