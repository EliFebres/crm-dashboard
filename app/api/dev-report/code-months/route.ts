export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireFounder } from '@/app/lib/auth/require-auth';
import { saveCodeMonths } from '@/app/lib/db/dev-report';
import { NO_DB, errorResponse } from '../_shared';

// PUT /api/dev-report/code-months — founder only. Body: { months: DevCodeMonth[] }.
// Replaces this year's monthly code stats.
export async function PUT(req: NextRequest) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    return NextResponse.json({ months: await saveCodeMonths(body?.months) });
  } catch (err) {
    return errorResponse(err, 'PUT /api/dev-report/code-months');
  }
}
