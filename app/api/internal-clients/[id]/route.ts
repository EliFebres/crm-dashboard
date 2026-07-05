export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { updateInternalClient, deleteInternalClient, InternalClientError } from '@/app/lib/db/internalClients';
import { logActivity } from '@/app/lib/activity/log';

const NO_DB = { error: 'Database not configured. Set SQLITE_DIR to enable write operations.' };

// PATCH /api/internal-clients/:id — editors only. Body: { name?, department? }
// A name change cascades into engagements.internal_client_name.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const { id } = await params;
    const body = await req.json();
    const updated = await updateInternalClient(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      department: typeof body.department === 'string' ? body.department : undefined,
    });
    void logActivity(req, {
      action: 'internalClient.update',
      entityType: 'internalClient',
      entityId: id,
      details: { name: updated.name, department: updated.department },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof InternalClientError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[PATCH /api/internal-clients/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// DELETE /api/internal-clients/:id — editors only. Refuses while still in use.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const { id } = await params;
    const name = await deleteInternalClient(id);
    void logActivity(req, {
      action: 'internalClient.delete',
      entityType: 'internalClient',
      entityId: id,
      details: { name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof InternalClientError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[DELETE /api/internal-clients/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
