/**
 * Data layer for the managed internal-client registry.
 *
 * The name + department are denormalized onto engagements (`internal_client_name`,
 * `internal_client_dept`); a rename cascades into engagements atomically, mirroring
 * the departments and external-clients cascades. Lives in engagements.sqlite.
 */
import { query, executeTransaction } from './index';
import { departmentExists } from './departments';
import { randomUUID } from 'crypto';

export interface InternalClientRow {
  id: string;
  name: string;
  department: string;
  /** Engagements referencing this internal client — drives the delete guard. */
  assignedCount: number;
}

/** Carries an HTTP status so route handlers can translate it to a response. */
export class InternalClientError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'InternalClientError';
  }
}

/** List internal clients (alphabetical) with how many engagements use each. */
export async function listInternalClients(): Promise<InternalClientRow[]> {
  const rows = await query<{ id: string; name: string; department: string; assigned_count: number }>(
    `SELECT c.id, c.name, c.department,
            (SELECT COUNT(*) FROM engagements e WHERE e.internal_client_name = c.name) AS assigned_count
       FROM internal_clients c
      ORDER BY c.name COLLATE NOCASE`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    department: r.department,
    assignedCount: Number(r.assigned_count),
  }));
}

/** Create an internal client. 409 on duplicate name, 400 on unknown department. */
export async function createInternalClient(
  rawName: string,
  rawDepartment: string,
  creator?: { id: string; name: string }
): Promise<InternalClientRow> {
  const name = rawName.trim();
  const department = rawDepartment.trim();
  if (!name) throw new InternalClientError(400, 'An internal client name is required.');
  if (!department) throw new InternalClientError(400, 'A department is required.');
  if (!(await departmentExists(department))) {
    throw new InternalClientError(400, `Unknown department "${department}".`);
  }

  const dupe = await query(`SELECT 1 FROM internal_clients WHERE name = ? COLLATE NOCASE`, [name]);
  if (dupe.length > 0) throw new InternalClientError(409, `An internal client named "${name}" already exists.`);

  const id = randomUUID();
  await executeTransaction((tx) => {
    tx.run(
      `INSERT INTO internal_clients (id, name, department, created_by_id, created_by_name) VALUES (?, ?, ?, ?, ?)`,
      [id, name, department, creator?.id ?? null, creator?.name ?? null]
    );
  });
  return { id, name, department, assignedCount: 0 };
}

/**
 * Ensure an internal client exists in the registry (idempotent, best-effort).
 *
 * Called as a side-effect of engagement writes so a free-form name typed into the
 * New/Edit Interaction form also lands in the managed registry. Unlike
 * createInternalClient, this never throws for the caller to handle: it returns
 * false (a no-op) when the name/department is blank or the department is unknown,
 * so a registry hiccup can't fail the engagement write. Uses INSERT OR IGNORE
 * against the unique name index, so it's race-safe and a duplicate is a silent
 * no-op. Returns true only when a new row was actually inserted.
 */
export async function ensureInternalClient(
  rawName: string,
  rawDepartment: string,
  creator?: { id: string; name: string }
): Promise<boolean> {
  const name = (rawName ?? '').trim();
  const department = (rawDepartment ?? '').trim();
  if (!name || !department) return false;
  if (!(await departmentExists(department))) return false;

  const id = randomUUID();
  return executeTransaction<boolean>((tx) => {
    const result = tx.run(
      `INSERT OR IGNORE INTO internal_clients (id, name, department, created_by_id, created_by_name)
         VALUES (?, ?, ?, ?, ?)`,
      [id, name, department, creator?.id ?? null, creator?.name ?? null]
    );
    return result.changes > 0;
  });
}

/**
 * Update an internal client's name and/or department. A name change cascades into
 * engagements.internal_client_name. Atomic.
 */
export async function updateInternalClient(
  id: string,
  patch: { name?: string; department?: string }
): Promise<InternalClientRow> {
  // Validate the target department (if changing) up front — outside the tx, which
  // must stay synchronous.
  const nextDeptRaw = typeof patch.department === 'string' ? patch.department.trim() : undefined;
  if (nextDeptRaw !== undefined && nextDeptRaw !== '' && !(await departmentExists(nextDeptRaw))) {
    throw new InternalClientError(400, `Unknown department "${nextDeptRaw}".`);
  }

  return executeTransaction<InternalClientRow>((tx) => {
    const current = tx.get<{ name: string; department: string }>(
      `SELECT name, department FROM internal_clients WHERE id = ?`, [id]
    );
    if (!current) throw new InternalClientError(404, 'That internal client no longer exists.');

    const nextName = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : current.name;
    const nextDept = nextDeptRaw && nextDeptRaw !== '' ? nextDeptRaw : current.department;

    if (nextName !== current.name) {
      const dupe = tx.get(`SELECT 1 FROM internal_clients WHERE name = ? COLLATE NOCASE AND id != ?`, [nextName, id]);
      if (dupe) throw new InternalClientError(409, `An internal client named "${nextName}" already exists.`);
    }

    tx.run(
      `UPDATE internal_clients SET name = ?, department = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [nextName, nextDept, id]
    );
    if (nextName !== current.name) {
      tx.run(`UPDATE engagements SET internal_client_name = ? WHERE internal_client_name = ?`, [nextName, current.name]);
    }

    const assigned = tx.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM engagements WHERE internal_client_name = ?`, [nextName]
    )?.c ?? 0;

    return { id, name: nextName, department: nextDept, assignedCount: Number(assigned) };
  });
}

/**
 * Delete an internal client. Refuses (409) while any engagement still references its
 * name, so no engagement is orphaned. Returns the deleted name.
 */
export async function deleteInternalClient(id: string): Promise<string> {
  return executeTransaction<string>((tx) => {
    const current = tx.get<{ name: string }>(`SELECT name FROM internal_clients WHERE id = ?`, [id]);
    if (!current) throw new InternalClientError(404, 'That internal client no longer exists.');

    const assigned = tx.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM engagements WHERE internal_client_name = ?`, [current.name]
    )?.c ?? 0;
    if (assigned > 0) {
      throw new InternalClientError(
        409,
        `Can't delete — ${assigned} engagement(s) still reference this internal client. Reassign them first.`
      );
    }

    tx.run(`DELETE FROM internal_clients WHERE id = ?`, [id]);
    return current.name;
  });
}
