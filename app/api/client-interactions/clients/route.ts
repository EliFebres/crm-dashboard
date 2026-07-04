export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, executeTransaction, hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { crnConfig, normalizeCrn, isValidCrn, generateNextCrn, generatePendingCrn } from '@/app/lib/config/crn';
import { logActivity } from '@/app/lib/activity/log';
import { clients as mockEngagementClients } from '@/app/lib/data/engagements';
import type { Client } from '@/app/lib/types/engagements';

// Internal error type so transaction callbacks can signal an HTTP status.
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// GET /api/client-interactions/clients?q=&limit=
// Searches the registry by canonical name OR CRN.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    const sp = req.nextUrl.searchParams;
    const q = (sp.get('q') || '').trim().toLowerCase();
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 500);

    if (!hasDb()) {
      // Mock fallback: derive the registry from the in-memory mock engagements.
      const filtered = mockEngagementClients
        .filter(c => !q || c.name.toLowerCase().includes(q) || c.crn.toLowerCase().includes(q))
        .slice(0, limit);
      return NextResponse.json({ clients: filtered });
    }

    const like = `%${q}%`;
    const rows = await query<{ crn: string; name: string; created_by_name: string | null; crn_pending: number }>(
      `SELECT crn, name, created_by_name, crn_pending
       FROM clients
       WHERE (? = '' OR lower(name) LIKE ? OR lower(crn) LIKE ?)
       ORDER BY name COLLATE NOCASE ASC
       LIMIT ?`,
      [q, like, like, limit]
    );
    const clients: Client[] = rows.map(r => ({
      crn: r.crn,
      name: r.name,
      createdByName: r.created_by_name ?? undefined,
      crnPending: Boolean(r.crn_pending),
    }));
    return NextResponse.json({ clients });
  } catch (err) {
    console.error('GET /api/client-interactions/clients error:', err);
    return NextResponse.json({ error: 'Failed to fetch clients' }, { status: 500 });
  }
}

// POST /api/client-interactions/clients
// Body: { name: string; crn?: string }  (crn ignored in auto-generate mode)
export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Client name is required.' }, { status: 400 });
    }

    const { autoGenerate } = crnConfig();
    // Pending registration: the user has the client but not its CRN yet. Only
    // meaningful in manual mode (auto mode always has a CRN). The system assigns a
    // placeholder CRN and flags it so the interaction can be created and the real
    // CRN filled in later.
    const pending = body.pending === true && !autoGenerate;

    let manualCrn = '';
    if (!autoGenerate && !pending) {
      manualCrn = normalizeCrn(typeof body.crn === 'string' ? body.crn : '');
      if (!manualCrn) {
        return NextResponse.json({ error: 'CRN is required.' }, { status: 400 });
      }
      if (!isValidCrn(manualCrn)) {
        return NextResponse.json({ error: 'Invalid CRN format.' }, { status: 400 });
      }
    }

    let crn = '';
    await executeTransaction((tx) => {
      crn = pending ? generatePendingCrn(tx) : autoGenerate ? generateNextCrn(tx) : manualCrn;

      if (tx.get(`SELECT 1 FROM clients WHERE crn = ?`, [crn])) {
        throw new HttpError(409, 'A client with that CRN already exists.');
      }
      if (tx.get(`SELECT 1 FROM clients WHERE name = ? COLLATE NOCASE`, [name])) {
        throw new HttpError(409, 'A client with that name already exists.');
      }

      tx.run(
        `INSERT INTO clients (crn, name, crn_pending, created_by_id, created_by_name) VALUES (?, ?, ?, ?, ?)`,
        [crn, name, pending ? 1 : 0, auth.payload.sub, `${auth.payload.firstName} ${auth.payload.lastName}`]
      );
    });

    void logActivity(req, {
      action: 'client.create',
      entityType: 'client',
      entityId: crn,
      details: { name, ...(pending ? { crnPending: true } : {}) },
    });
    const client: Client = { crn, name, crnPending: pending };
    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('POST /api/client-interactions/clients error:', err);
    return NextResponse.json({ error: 'Failed to register client' }, { status: 500 });
  }
}
