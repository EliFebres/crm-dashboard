export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { normalizeCrn } from '@/app/lib/config/crn';
import { listClientModels, replaceClientModels, ClientModelError } from '@/app/lib/db/clientModels';
import { logActivity } from '@/app/lib/activity/log';

// GET /api/client-interactions/clients/:crn/models — authenticated.
// Lists the client's model portfolios (shared, canonical). Mock fallback: empty set.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ crn: string }> }
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    if (!hasDb()) return NextResponse.json({ models: [] });
    const { crn: rawCrn } = await params;
    const crn = normalizeCrn(decodeURIComponent(rawCrn));
    return NextResponse.json({ models: await listClientModels(crn) });
  } catch (err) {
    if (err instanceof ClientModelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[GET /api/client-interactions/clients/[crn]/models]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// PUT /api/client-interactions/clients/:crn/models — editors only.
// Body: { models: ClientModel[] } — atomically replaces the client's whole model set.
export async function PUT(
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
    const models = await replaceClientModels(crn, body?.models);
    void logActivity(req, {
      action: 'clientModel.replace',
      entityType: 'client',
      entityId: crn,
      details: { count: models.length },
    });
    return NextResponse.json({ models });
  } catch (err) {
    if (err instanceof ClientModelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[PUT /api/client-interactions/clients/[crn]/models]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
