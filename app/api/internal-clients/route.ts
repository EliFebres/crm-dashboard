export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { listInternalClients, createInternalClient, InternalClientError } from '@/app/lib/db/internalClients';
import { logActivity } from '@/app/lib/activity/log';
import { engagements as mockEngagements } from '@/app/lib/data/engagements';

// GET /api/internal-clients — authenticated. Lists the managed registry + usage counts.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    if (!hasDb()) {
      // Mock fallback: derive distinct internal clients from in-memory engagements.
      const byName = new Map<string, { department: string; count: number }>();
      mockEngagements.forEach(e => {
        const existing = byName.get(e.internalClient.name);
        if (existing) existing.count += 1;
        else byName.set(e.internalClient.name, { department: e.internalClient.clientDept, count: 1 });
      });
      const internalClients = Array.from(byName.entries())
        .map(([name, v]) => ({ id: name, name, department: v.department, assignedCount: v.count }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({ internalClients });
    }

    return NextResponse.json({ internalClients: await listInternalClients() });
  } catch (err) {
    console.error('[GET /api/internal-clients]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/internal-clients — editors only. Body: { name, department }
export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const body = await req.json();
    const created = await createInternalClient(
      typeof body.name === 'string' ? body.name : '',
      typeof body.department === 'string' ? body.department : '',
      { id: auth.payload.sub, name: `${auth.payload.firstName} ${auth.payload.lastName}`.trim() }
    );
    void logActivity(req, {
      action: 'internalClient.create',
      entityType: 'internalClient',
      entityId: created.id,
      details: { name: created.name, department: created.department },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof InternalClientError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/internal-clients]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
