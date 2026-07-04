export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireAuth, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { updateIntakeType, deleteIntakeType, IntakeTypeError } from '@/app/lib/db/intakeTypes';
import { logActivity } from '@/app/lib/activity/log';

const NO_DB = { error: 'Database not configured. Set SQLITE_DIR to enable write operations.' };

// PATCH /api/intake-types/:id — editors only. Body: { name?, color?, sortOrder? }
// A name change cascades into engagements.intake_type.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const { id } = await params;
    const body = await req.json();
    const updated = await updateIntakeType(id, {
      name: typeof body.name === 'string' ? body.name : undefined,
      color: body.color,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    });
    void logActivity(req, {
      action: 'intakeType.update',
      entityType: 'intakeType',
      entityId: id,
      details: { name: updated.name },
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof IntakeTypeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[PATCH /api/intake-types/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// DELETE /api/intake-types/:id — editors only. Refuses for built-ins or while in use.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const { id } = await params;
    const name = await deleteIntakeType(id);
    void logActivity(req, {
      action: 'intakeType.delete',
      entityType: 'intakeType',
      entityId: id,
      details: { name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof IntakeTypeError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[DELETE /api/intake-types/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
