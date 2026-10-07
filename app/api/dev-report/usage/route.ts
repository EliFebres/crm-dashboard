export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireFounder } from '@/app/lib/auth/require-auth';
import { importUsage, clearUsage } from '@/app/lib/db/dev-report';
import { NO_DB, errorResponse } from '../_shared';

// POST /api/dev-report/usage — founder only. Body: { rows: { day, tool, count }[] }.
// Upserts daily usage; tools the inventory doesn't know yet are added to it.
export async function POST(req: NextRequest) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    return NextResponse.json(await importUsage(body?.rows));
  } catch (err) {
    return errorResponse(err, 'POST /api/dev-report/usage');
  }
}

// DELETE /api/dev-report/usage — founder only. Clears all usage rows (tools are kept).
export async function DELETE(req: NextRequest) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    await clearUsage();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 'DELETE /api/dev-report/usage');
  }
}
