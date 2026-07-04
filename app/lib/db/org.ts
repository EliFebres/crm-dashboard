/**
 * Shared data layer for the editable Teams / Offices lists.
 *
 * Both lists behave identically — a name table plus a cascade into the `team` /
 * `office` columns of `users` and `team_members` — so the logic lives here once
 * and the API routes parameterize it by {@link OrgKind}.
 */
import { queryUsers, executeUsers, usersTransaction } from './users';
import { randomUUID } from 'crypto';

export type OrgKind = 'team' | 'office';

export interface OrgItem {
  id: string;
  name: string;
  /** Admin-defined display order; drives sign-up / team-member dropdowns. */
  sortOrder: number;
  /** Number of users + team_members currently assigned this team/office. */
  assignedCount: number;
}

/** Carries an HTTP status so route handlers can translate it to a response. */
export class OrgError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'OrgError';
  }
}

interface OrgConfig {
  table: 'teams' | 'offices';
  column: 'team' | 'office';
  label: string;
}

const CONFIG: Record<OrgKind, OrgConfig> = {
  team: { table: 'teams', column: 'team', label: 'team' },
  office: { table: 'offices', column: 'office', label: 'office' },
};

/** List all teams/offices with how many users + members are assigned to each. */
export async function listOrg(kind: OrgKind): Promise<OrgItem[]> {
  const { table, column } = CONFIG[kind];
  const rows = await queryUsers<{ id: string; name: string; sort_order: number; assigned_count: number }>(
    `SELECT t.id, t.name, t.sort_order,
            (SELECT COUNT(*) FROM users u        WHERE u.${column}  = t.name)
          + (SELECT COUNT(*) FROM team_members m WHERE m.${column}  = t.name) AS assigned_count
       FROM ${table} t
      ORDER BY t.sort_order, t.name COLLATE NOCASE`
  );
  return rows.map(r => ({ id: r.id, name: r.name, sortOrder: Number(r.sort_order), assignedCount: Number(r.assigned_count) }));
}

/** Create a new team/office. Throws OrgError(409) on a case-insensitive duplicate. */
export async function createOrg(kind: OrgKind, rawName: string): Promise<OrgItem> {
  const { table, label } = CONFIG[kind];
  const name = rawName.trim();
  if (!name) throw new OrgError(400, `A ${label} name is required.`);

  const dupe = await queryUsers(`SELECT 1 FROM ${table} WHERE name = ? COLLATE NOCASE`, [name]);
  if (dupe.length > 0) throw new OrgError(409, `A ${label} named "${name}" already exists.`);

  const id = randomUUID();
  const maxRow = await queryUsers<{ m: number }>(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ${table}`);
  const sortOrder = Number(maxRow[0]?.m ?? -1) + 1;
  await executeUsers(`INSERT INTO ${table} (id, name, sort_order) VALUES (?, ?, ?)`, [id, name, sortOrder]);
  return { id, name, sortOrder, assignedCount: 0 };
}

/**
 * Rename a team/office and cascade the new name into every `users` and
 * `team_members` row that referenced the old one. Atomic.
 */
export async function renameOrg(kind: OrgKind, id: string, rawName: string): Promise<OrgItem> {
  const { table, column, label } = CONFIG[kind];
  const name = rawName.trim();
  if (!name) throw new OrgError(400, `A ${label} name is required.`);

  return usersTransaction<OrgItem>((tx) => {
    const current = tx.get<{ name: string; sort_order: number }>(`SELECT name, sort_order FROM ${table} WHERE id = ?`, [id]);
    if (!current) throw new OrgError(404, `That ${label} no longer exists.`);

    if (current.name !== name) {
      const dupe = tx.get(`SELECT 1 FROM ${table} WHERE name = ? COLLATE NOCASE AND id != ?`, [name, id]);
      if (dupe) throw new OrgError(409, `A ${label} named "${name}" already exists.`);
    }

    tx.run(`UPDATE ${table} SET name = ? WHERE id = ?`, [name, id]);
    tx.run(`UPDATE users        SET ${column} = ? WHERE ${column} = ?`, [name, current.name]);
    tx.run(`UPDATE team_members SET ${column} = ? WHERE ${column} = ?`, [name, current.name]);

    const assigned =
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM users        WHERE ${column} = ?`, [name])?.c ?? 0) +
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM team_members WHERE ${column} = ?`, [name])?.c ?? 0);

    return { id, name, sortOrder: Number(current.sort_order), assignedCount: Number(assigned) };
  });
}

/**
 * Delete a team/office. Refuses (OrgError 409) while any user or team member is
 * still assigned to it, so no rows are orphaned. Returns the deleted name.
 */
export async function deleteOrg(kind: OrgKind, id: string): Promise<string> {
  const { table, column, label } = CONFIG[kind];

  return usersTransaction<string>((tx) => {
    const current = tx.get<{ name: string }>(`SELECT name FROM ${table} WHERE id = ?`, [id]);
    if (!current) throw new OrgError(404, `That ${label} no longer exists.`);

    const assigned =
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM users        WHERE ${column} = ?`, [current.name])?.c ?? 0) +
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM team_members WHERE ${column} = ?`, [current.name])?.c ?? 0);
    if (assigned > 0) {
      throw new OrgError(
        409,
        `Can't delete — ${assigned} user(s)/member(s) are still assigned to this ${label}. Reassign them first.`
      );
    }

    tx.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return current.name;
  });
}

/**
 * Persist a new display order. `orderedIds` lists the team/office ids in the
 * desired order; each row's `sort_order` is set to its index. Atomic.
 */
export async function reorderOrg(kind: OrgKind, orderedIds: string[]): Promise<void> {
  const { table } = CONFIG[kind];
  await usersTransaction<void>((tx) => {
    orderedIds.forEach((id, index) => {
      tx.run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [index, id]);
    });
  });
}

/** True if `name` is a valid team/office (used by signup + team-member validation). */
export async function orgNameExists(kind: OrgKind, name: string): Promise<boolean> {
  const { table } = CONFIG[kind];
  const rows = await queryUsers(`SELECT 1 FROM ${table} WHERE name = ? COLLATE NOCASE`, [name]);
  return rows.length > 0;
}
