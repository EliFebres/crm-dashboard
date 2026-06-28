export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/auth/require-auth';
import { crnConfig } from '@/app/lib/config/crn';

// GET /api/client-interactions/clients/config
// Tells the UI how CRNs are sourced so it knows whether to collect one.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  const { autoGenerate, prefix } = crnConfig();
  return NextResponse.json({ autoGenerate, prefix });
}
