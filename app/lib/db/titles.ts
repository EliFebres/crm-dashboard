/**
 * Data layer for the editable rank Titles list.
 *
 * A title is denormalized onto both `users.title` and `team_members.title`, so a
 * rename must cascade into both — atomically in one transaction (mirrors the
 * teams/offices logic in org.ts). `sort_order` is the rank relative to the other
 * titles; drag-to-reorder in Settings rewrites it.
 */
import { queryUsers, executeUsers, usersTransaction } from './users';
import { randomUUID } from 'crypto';

export interface TitleItem {
  id: string;
  name: string;
  /** Admin-defined rank; drives sign-up / roster dropdowns and the "something else soon". */
  sortOrder: number;
  /** Users + team_members currently holding this title — drives the delete guard. */
  assignedCount: number;
}

/** Carries an HTTP status so route handlers can translate it to a response. */
export class TitleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'TitleError';
  }
}

/** List all titles by rank, each with how many users + members hold it. */
export async function listTitles(): Promise<TitleItem[]> {
  const rows = await queryUsers<{ id: string; name: string; sort_order: number; assigned_count: number }>(
    `SELECT t.id, t.name, t.sort_order,
            (SELECT COUNT(*) FROM users u        WHERE u.title = t.name)
          + (SELECT COUNT(*) FROM team_members m WHERE m.title = t.name) AS assigned_count
       FROM titles t
      ORDER BY t.sort_order, t.name COLLATE NOCASE`
  );
  return rows.map(r => ({ id: r.id, name: r.name, sortOrder: Number(r.sort_order), assignedCount: Number(r.assigned_count) }));
}

/** Plain list of title names, in rank order (for form dropdowns). */
export async function listTitleNames(): Promise<string[]> {
  const rows = await queryUsers<{ name: string }>(
    `SELECT name FROM titles ORDER BY sort_order, name COLLATE NOCASE`
  );
  return rows.map(r => r.name);
}

/** Create a new title, appended after the current lowest rank. Throws TitleError(409) on a dup. */
export async function createTitle(rawName: string): Promise<TitleItem> {
  const name = rawName.trim();
  if (!name) throw new TitleError(400, 'A title name is required.');

  const dupe = await queryUsers(`SELECT 1 FROM titles WHERE name = ? COLLATE NOCASE`, [name]);
  if (dupe.length > 0) throw new TitleError(409, `A title named "${name}" already exists.`);

  const id = randomUUID();
  const maxRow = await queryUsers<{ m: number }>(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM titles`);
  const sortOrder = Number(maxRow[0]?.m ?? -1) + 1;
  await executeUsers(`INSERT INTO titles (id, name, sort_order) VALUES (?, ?, ?)`, [id, name, sortOrder]);
  return { id, name, sortOrder, assignedCount: 0 };
}

/**
 * Rename a title and cascade the new name into every `users` and `team_members`
 * row that referenced the old one. Atomic.
 */
export async function renameTitle(id: string, rawName: string): Promise<TitleItem> {
  const name = rawName.trim();
  if (!name) throw new TitleError(400, 'A title name is required.');

  return usersTransaction<TitleItem>((tx) => {
    const current = tx.get<{ name: string; sort_order: number }>(`SELECT name, sort_order FROM titles WHERE id = ?`, [id]);
    if (!current) throw new TitleError(404, 'That title no longer exists.');

    if (current.name !== name) {
      const dupe = tx.get(`SELECT 1 FROM titles WHERE name = ? COLLATE NOCASE AND id != ?`, [name, id]);
      if (dupe) throw new TitleError(409, `A title named "${name}" already exists.`);
    }

    tx.run(`UPDATE titles       SET name = ? WHERE id = ?`, [name, id]);
    tx.run(`UPDATE users        SET title = ? WHERE title = ?`, [name, current.name]);
    tx.run(`UPDATE team_members SET title = ? WHERE title = ?`, [name, current.name]);

    const assigned =
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM users        WHERE title = ?`, [name])?.c ?? 0) +
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM team_members WHERE title = ?`, [name])?.c ?? 0);

    return { id, name, sortOrder: Number(current.sort_order), assignedCount: Number(assigned) };
  });
}

/**
 * Delete a title. Refuses (TitleError 409) while any user or team member still
 * holds it, so no one is left with a dangling title. Returns the deleted name.
 */
export async function deleteTitle(id: string): Promise<string> {
  return usersTransaction<string>((tx) => {
    const current = tx.get<{ name: string }>(`SELECT name FROM titles WHERE id = ?`, [id]);
    if (!current) throw new TitleError(404, 'That title no longer exists.');

    const assigned =
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM users        WHERE title = ?`, [current.name])?.c ?? 0) +
      (tx.get<{ c: number }>(`SELECT COUNT(*) AS c FROM team_members WHERE title = ?`, [current.name])?.c ?? 0);
    if (assigned > 0) {
      throw new TitleError(
        409,
        `Can't delete — ${assigned} person/people still hold this title. Reassign them first.`
      );
    }

    tx.run(`DELETE FROM titles WHERE id = ?`, [id]);
    return current.name;
  });
}

/**
 * Persist a new rank order. `orderedIds` lists the title ids in the desired
 * order; each row's `sort_order` is set to its index. Atomic.
 */
export async function reorderTitles(orderedIds: string[]): Promise<void> {
  await usersTransaction<void>((tx) => {
    orderedIds.forEach((id, index) => {
      tx.run(`UPDATE titles SET sort_order = ? WHERE id = ?`, [index, id]);
    });
  });
}

/** True if `name` is a valid title (used by signup + roster/user validation). */
export async function titleExists(name: string): Promise<boolean> {
  const rows = await queryUsers(`SELECT 1 FROM titles WHERE name = ? COLLATE NOCASE`, [name]);
  return rows.length > 0;
}
