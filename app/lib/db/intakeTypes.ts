/**
 * Data layer for the managed intake types.
 *
 * The intake-type NAME is denormalized onto engagements.intake_type, so a rename
 * must cascade into engagements — atomically in one transaction (mirrors the
 * departments cascade in app/lib/db/departments.ts).
 *
 * Three built-ins carry a stable `role` (`irq` / `serf` / `ad_hoc`). Business
 * logic (the Ad-Hoc channel field, KPI metric buckets) binds to the role, not the
 * display name, so admins may rename any built-in freely. Role-bearing rows can't
 * be DELETED, though — deleting them would strip features that depend on them.
 * Custom intake types (role = NULL) add/rename/delete like departments.
 */
import { query, executeTransaction } from './index';
import { randomUUID } from 'crypto';

export interface IntakeTypeRow {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** Stable key for built-ins (`irq`/`serf`/`ad_hoc`); null for custom types. */
  role: string | null;
  /** Engagements using this intake type — drives the delete guard. */
  assignedCount: number;
}

/** Carries an HTTP status so route handlers can translate it to a response. */
export class IntakeTypeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'IntakeTypeError';
  }
}

// Fallback display names should the seed ever be missing — keeps metric SQL sane.
const ROLE_FALLBACK: Record<string, string> = { irq: 'IRQ', serf: 'SERF', ad_hoc: 'Ad-Hoc' };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeColor(raw: unknown, fallback = '#71717a'): string {
  if (typeof raw !== 'string') return fallback;
  const c = raw.trim();
  return HEX_COLOR.test(c) ? c.toLowerCase() : fallback;
}

/** List intake types ordered by sort_order then name, each with its usage count. */
export async function listIntakeTypes(): Promise<IntakeTypeRow[]> {
  const rows = await query<{ id: string; name: string; color: string; sort_order: number; role: string | null; assigned_count: number }>(
    `SELECT t.id, t.name, t.color, t.sort_order, t.role,
            (SELECT COUNT(*) FROM engagements e WHERE e.intake_type = t.name) AS assigned_count
       FROM intake_types t
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

/** Plain list of intake-type names (for filter options / form dropdowns). */
export async function listIntakeTypeNames(): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT name FROM intake_types ORDER BY sort_order, name COLLATE NOCASE`
  );
  return rows.map(r => r.name);
}

/** Name → color map (for chart coloring). */
export async function intakeColorMap(): Promise<Record<string, string>> {
  const rows = await query<{ name: string; color: string }>(
    `SELECT name, color FROM intake_types ORDER BY sort_order, name COLLATE NOCASE`
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.name] = r.color;
  return map;
}

/**
 * Current display name for a built-in role (e.g. 'ad_hoc' → 'Ad-Hoc', or whatever
 * an admin renamed it to). Lets metric SQL reference roles instead of hardcoded
 * literals so a rename never breaks a KPI. Falls back to the canonical literal.
 */
export async function intakeNameForRole(role: string): Promise<string> {
  const rows = await query<{ name: string }>(`SELECT name FROM intake_types WHERE role = ? LIMIT 1`, [role]);
  return rows[0]?.name ?? ROLE_FALLBACK[role] ?? role;
}

/** Create a custom intake type. Throws IntakeTypeError(409) on a dup name. */
export async function createIntakeType(rawName: string, rawColor?: unknown): Promise<IntakeTypeRow> {
  const name = rawName.trim();
  if (!name) throw new IntakeTypeError(400, 'An intake type name is required.');
  const color = normalizeColor(rawColor);

  const dupe = await query(`SELECT 1 FROM intake_types WHERE name = ? COLLATE NOCASE`, [name]);
  if (dupe.length > 0) throw new IntakeTypeError(409, `An intake type named "${name}" already exists.`);

  const id = randomUUID();
  const maxRow = await query<{ m: number }>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM intake_types`);
  const sortOrder = Number(maxRow[0]?.m ?? 0) + 1;
  await executeTransaction((tx) => {
    tx.run(`INSERT INTO intake_types (id, name, color, sort_order, role) VALUES (?, ?, ?, ?, NULL)`, [id, name, color, sortOrder]);
  });
  return { id, name, color, sortOrder, role: null, assignedCount: 0 };
}

/**
 * Update an intake type's name and/or color. A name change cascades into
 * engagements.intake_type (including for built-ins — the role is preserved). Atomic.
 */
export async function updateIntakeType(
  id: string,
  patch: { name?: string; color?: unknown; sortOrder?: number }
): Promise<IntakeTypeRow> {
  return executeTransaction<IntakeTypeRow>((tx) => {
    const current = tx.get<{ name: string; color: string; sort_order: number; role: string | null }>(
      `SELECT name, color, sort_order, role FROM intake_types WHERE id = ?`, [id]
    );
    if (!current) throw new IntakeTypeError(404, 'That intake type no longer exists.');

    const nextName = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name;
    const nextColor = patch.color === undefined ? current.color : normalizeColor(patch.color, current.color);
    const nextOrder = typeof patch.sortOrder === 'number' ? patch.sortOrder : current.sort_order;

    if (nextName !== current.name) {
      const dupe = tx.get(`SELECT 1 FROM intake_types WHERE name = ? COLLATE NOCASE AND id != ?`, [nextName, id]);
      if (dupe) throw new IntakeTypeError(409, `An intake type named "${nextName}" already exists.`);
    }

    tx.run(
      `UPDATE intake_types SET name = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextName, nextColor, nextOrder, id]
    );

    if (nextName !== current.name) {
      tx.run(`UPDATE engagements SET intake_type = ? WHERE intake_type = ?`, [nextName, current.name]);
    }

    const assigned = tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM engagements WHERE intake_type = ?`, [nextName])?.c ?? 0;
    return { id, name: nextName, color: nextColor, sortOrder: Number(nextOrder), role: current.role ?? null, assignedCount: Number(assigned) };
  });
}

/**
 * Delete an intake type. Refuses (409) for a built-in (role != NULL) — its
 * behavior is hardwired — or while any engagement still uses it. Returns the name.
 */
export async function deleteIntakeType(id: string): Promise<string> {
  return executeTransaction<string>((tx) => {
    const current = tx.get<{ name: string; role: string | null }>(`SELECT name, role FROM intake_types WHERE id = ?`, [id]);
    if (!current) throw new IntakeTypeError(404, 'That intake type no longer exists.');

    if (current.role) {
      throw new IntakeTypeError(409, `Can't delete "${current.name}" — it's a built-in intake type. You can rename it, but not remove it.`);
    }

    const assigned = tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM engagements WHERE intake_type = ?`, [current.name])?.c ?? 0;
    if (assigned > 0) {
      throw new IntakeTypeError(409, `Can't delete — ${assigned} engagement(s) still use this intake type. Reassign them first.`);
    }

    tx.run(`DELETE FROM intake_types WHERE id = ?`, [id]);
    return current.name;
  });
}
