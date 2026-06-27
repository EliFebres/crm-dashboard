export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, hasDb } from '@/app/lib/db';
import { requireAuth, teamConstraint } from '@/app/lib/auth/require-auth';
import { engagements as mockEngagements } from '@/app/lib/data/engagements';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    if (!hasDb()) {
      // Mock fallback: derive unique clients from in-memory mock data
      const clientMap = new Map<string, string>();
      mockEngagements.forEach(e => {
        clientMap.set(e.internalClient.name, e.internalClient.gcgDepartment);
      });
      const clients = Array.from(clientMap.entries())
        .map(([name, dept]) => ({ name, dept }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({ clients });
    }

    const teamClause = sc.team ? 'WHERE team = ?' : '';
    const teamParams = sc.team ? [sc.team] : [];
    const rows = await query<{ name: string; dept: string }>(
      `SELECT DISTINCT internal_client_name AS name, internal_client_dept AS dept
       FROM engagements
       ${teamClause}
       ORDER BY internal_client_name ASC`,
      teamParams
    );
    return NextResponse.json({ clients: rows });
  } catch (err) {
    console.error('[GET /api/client-interactions/gcg-clients]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
