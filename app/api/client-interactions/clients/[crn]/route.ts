export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, executeTransaction, hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { normalizeCrn, isValidCrn, isPendingCrn } from '@/app/lib/config/crn';
import { logActivity } from '@/app/lib/activity/log';
import type { Client } from '@/app/lib/types/engagements';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// PATCH /api/client-interactions/clients/:crn
// Body: { name?: string; crn?: string } — updates the canonical name and/or the CRN.
// Changing the CRN cascades to every engagement that references it.
// Permissions:
//   - Admins may rename any client and change any CRN.
//   - Non-admin editors may ONLY resolve a *pending* client — i.e. replace its
//     placeholder CRN with the real value. They cannot rename or alter real CRNs.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ crn: string }> }
) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const { crn: rawCrn } = await params;
    const crn = normalizeCrn(decodeURIComponent(rawCrn));
    const body = await req.json();

    // Load the current client so we can gate on its pending state.
    const existing = await query<{ name: string; crn_pending: number }>(
      `SELECT name, crn_pending FROM clients WHERE crn = ?`,
      [crn]
    );
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }
    const isAdmin = auth.payload.role === 'admin';
    const targetPending = Boolean(existing[0].crn_pending);

    // Non-admins may only fill in a pending client's real CRN — nothing else.
    if (!isAdmin && !targetPending) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    // Admins may rename; non-admins keep the existing canonical name.
    const name = isAdmin
      ? (typeof body.name === 'string' ? body.name.trim() : '')
      : existing[0].name;
    if (!name) {
      return NextResponse.json({ error: 'Client name is required.' }, { status: 400 });
    }

    // Optional CRN change. Defaults to the current CRN (name-only update).
    const newCrn = typeof body.crn === 'string' && body.crn.trim() ? normalizeCrn(body.crn) : crn;
    if (!isValidCrn(newCrn)) {
      return NextResponse.json({ error: 'Invalid CRN format.' }, { status: 400 });
    }
    // Resolving a pending client requires a real, changed CRN (not another placeholder).
    if (!isAdmin && (newCrn === crn || isPendingCrn(newCrn))) {
      return NextResponse.json({ error: 'Enter the real CRN.' }, { status: 400 });
    }

    // The pending flag follows the CRN's shape: a placeholder stays pending, a real
    // CRN clears it. Lets admins mark/unmark pending simply by editing the CRN.
    const newPending = isPendingCrn(newCrn) ? 1 : 0;

    await executeTransaction((tx) => {
      if (tx.get(`SELECT 1 FROM clients WHERE name = ? COLLATE NOCASE AND crn != ?`, [name, crn])) {
        throw new HttpError(409, 'Another client already uses that name.');
      }

      if (newCrn !== crn) {
        if (tx.get(`SELECT 1 FROM clients WHERE crn = ?`, [newCrn])) {
          throw new HttpError(409, 'A client with that CRN already exists.');
        }
        // CRN is the PK and the engagements FK target. Defer FK checks to commit so
        // the parent rename and the child re-pointing land together atomically.
        tx.run(`PRAGMA defer_foreign_keys = ON`);
        tx.run(`UPDATE clients SET crn = ?, name = ?, crn_pending = ?, updated_at = CURRENT_TIMESTAMP WHERE crn = ?`, [newCrn, name, newPending, crn]);
        tx.run(`UPDATE engagements SET client_crn = ? WHERE client_crn = ?`, [newCrn, crn]);
        tx.run(`UPDATE client_models SET crn = ? WHERE crn = ?`, [newCrn, crn]);
      } else {
        tx.run(`UPDATE clients SET name = ?, crn_pending = ?, updated_at = CURRENT_TIMESTAMP WHERE crn = ?`, [name, newPending, crn]);
      }
    });

    void logActivity(req, {
      action: 'client.update',
      entityType: 'client',
      entityId: newCrn,
      details: { name, ...(newCrn !== crn ? { previousCrn: crn } : {}) },
    });
    const client: Client = { crn: newCrn, name, crnPending: Boolean(newPending) };
    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('PATCH /api/client-interactions/clients/[crn] error:', err);
    return NextResponse.json({ error: 'Failed to rename client' }, { status: 500 });
  }
}
