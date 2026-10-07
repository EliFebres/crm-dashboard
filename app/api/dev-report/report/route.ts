export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireFounder } from '@/app/lib/auth/require-auth';
import { computeDevReport } from '@/app/lib/db/dev-report';
import { errorResponse } from '../_shared';

// GET /api/dev-report/report — founder only. The computed year-to-date report.
export async function GET(req: NextRequest) {
  const auth = await requireFounder(req);
  if (auth.error) return auth.error;
  try {
    return NextResponse.json(await computeDevReport());
  } catch (err) {
    return errorResponse(err, 'GET /api/dev-report/report');
  }
}
