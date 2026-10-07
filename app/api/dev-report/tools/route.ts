export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { hasDb } from '@/app/lib/db';
import { requireFounder } from '@/app/lib/auth/require-auth';
import { createDevTool } from '@/app/lib/db/dev-report';
import { NO_DB, errorResponse } from '../_shared';

// POST /api/dev-report/tools — founder only. Body: DevToolInput (name required).
export async function POST(req: NextRequest) {
  if (!hasDb()) return NextResponse.json(NO_DB, { status: 503 });
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await createDevTool(await req.json()), { status: 201 });
  } catch (err) {
    return errorResponse(err, 'POST /api/dev-report/tools');
  }
}
