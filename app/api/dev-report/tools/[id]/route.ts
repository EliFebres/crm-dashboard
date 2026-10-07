export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireFounder } from '@/app/lib/auth/require-auth';
import { updateDevTool, deleteDevTool } from '@/app/lib/db/dev-report';
import { NO_DB, errorResponse } from '../../_shared';

// PATCH /api/dev-report/tools/:id — founder only. A rename cascades into usage rows.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    return NextResponse.json(await updateDevTool(id, await req.json()));
  } catch (err) {
    return errorResponse(err, 'PATCH /api/dev-report/tools/[id]');
  }
}

// DELETE /api/dev-report/tools/:id — founder only. Also removes the tool's usage rows.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    const { id } = await params;
    await deleteDevTool(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 'DELETE /api/dev-report/tools/[id]');
  }
}
