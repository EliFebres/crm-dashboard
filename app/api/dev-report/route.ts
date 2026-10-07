export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireFounder } from '@/app/lib/auth/require-auth';
import { getDevReportInputs } from '@/app/lib/db/dev-report';
import { errorResponse } from './_shared';

// GET /api/dev-report — founder only. Everything the entry page edits.
// Nothing under /api/dev-report logs activity: admins can read that log, and this is private.
export async function GET(req: NextRequest) {
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await getDevReportInputs());
  } catch (err) {
    return errorResponse(err, 'GET /api/dev-report');
  }
}
