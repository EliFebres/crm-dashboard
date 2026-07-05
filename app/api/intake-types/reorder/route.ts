export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { reorderIntakeTypes } from '@/app/lib/db/intakeTypes';
import { logActivity } from '@/app/lib/activity/log';

const NO_DB = { error: 'Database not configured. Set SQLITE_DIR to enable write operations.' };

// PATCH /api/intake-types/reorder — editors only. Body: { ids: string[] }
// Persists a new display order (sort_order = position in `ids`).
export async function PATCH(req: NextRequest) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: 'A non-empty "ids" array is required.' }, { status: 400 });
    }
    await reorderIntakeTypes(ids);
    void logActivity(req, {
      action: 'intakeType.reorder',
      entityType: 'intakeType',
      details: { count: ids.length },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[PATCH /api/intake-types/reorder]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
