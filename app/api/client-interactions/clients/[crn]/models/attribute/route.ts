export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { normalizeCrn } from '@/app/lib/config/crn';
import { attributeClientModels, ClientModelError } from '@/app/lib/db/clientModels';
import { logActivity } from '@/app/lib/activity/log';

// POST /api/client-interactions/clients/:crn/models/attribute — editors only.
// Body: { engagementId: number, modelIds: string[] }
//
// Records which interaction logged the given models. Only the create path needs this:
// models can be logged from the new-interaction form before that interaction exists, so
// PUT .../models saves them unattributed and returns their ids; once the interaction has
// an id, the client replays them here. Edit-mode saves attribute inline via PUT.
export async function POST(
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

    const engagementId = Number(body?.engagementId);
    if (!Number.isInteger(engagementId) || engagementId <= 0) {
      return NextResponse.json({ error: 'Invalid engagementId.' }, { status: 400 });
    }

    const modelIds = Array.isArray(body?.modelIds)
      ? body.modelIds.filter((id: unknown): id is string => typeof id === 'string' && !!id.trim())
      : [];

    const updated = await attributeClientModels(crn, engagementId, modelIds);

    void logActivity(req, {
      action: 'clientModel.attribute',
      entityType: 'client',
      entityId: crn,
      details: { engagementId, updated },
    });

    return NextResponse.json({ updated });
  } catch (err) {
    if (err instanceof ClientModelError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/client-interactions/clients/[crn]/models/attribute]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
