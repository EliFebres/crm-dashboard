export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { executeTransaction, hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { normalizeCrn, isValidCrn } from '@/app/lib/config/crn';
import { logActivity } from '@/app/lib/activity/log';
import type { Client } from '@/app/lib/types/engagements';

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// PATCH /api/client-interactions/clients/:crn
// Body: { name?: string; crn?: string } — updates the canonical name and/or the CRN.
// Changing the CRN cascades to every engagement that references it. Admin only.
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
  // Renaming a client's canonical name is an admin-only curation action.
  if (auth.payload.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const { crn: rawCrn } = await params;
    const crn = normalizeCrn(decodeURIComponent(rawCrn));
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Client name is required.' }, { status: 400 });
    }

    // Optional CRN change. Defaults to the current CRN (name-only update).
    const newCrn = typeof body.crn === 'string' && body.crn.trim() ? normalizeCrn(body.crn) : crn;
    if (!isValidCrn(newCrn)) {
      return NextResponse.json({ error: 'Invalid CRN format.' }, { status: 400 });
    }

    await executeTransaction((tx) => {
      if (!tx.get(`SELECT 1 FROM clients WHERE crn = ?`, [crn])) {
        throw new HttpError(404, 'Client not found.');
      }
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
        tx.run(`UPDATE clients SET crn = ?, name = ?, updated_at = CURRENT_TIMESTAMP WHERE crn = ?`, [newCrn, name, crn]);
        tx.run(`UPDATE engagements SET client_crn = ? WHERE client_crn = ?`, [newCrn, crn]);
      } else {
        tx.run(`UPDATE clients SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE crn = ?`, [name, crn]);
      }
    });

    void logActivity(req, {
      action: 'client.update',
      entityType: 'client',
      entityId: newCrn,
      details: { name, ...(newCrn !== crn ? { previousCrn: crn } : {}) },
    });
    const client: Client = { crn: newCrn, name };
    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('PATCH /api/client-interactions/clients/[crn] error:', err);
    return NextResponse.json({ error: 'Failed to rename client' }, { status: 500 });
  }
}
