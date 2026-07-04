export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, hasDb } from '@/app/lib/db';
import { requireAuth } from '@/app/lib/auth/require-auth';
import { engagements as mockEngagements } from '@/app/lib/data/engagements';

// GET /api/client-interactions/internal-clients
// The New Interaction form's internal-client combobox source. Reads from the managed
// `internal_clients` registry (global, not team-scoped) so newly-added clients appear
// immediately — even before any engagement uses them.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  try {
    if (!hasDb()) {
      // Mock fallback: derive unique clients from in-memory mock data
      const clientMap = new Map<string, string>();
      mockEngagements.forEach(e => {
        clientMap.set(e.internalClient.name, e.internalClient.clientDept);
      });
      const clients = Array.from(clientMap.entries())
        .map(([name, dept]) => ({ name, dept }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return NextResponse.json({ clients });
    }

    const rows = await query<{ name: string; dept: string }>(
      `SELECT name, department AS dept
       FROM internal_clients
       ORDER BY name COLLATE NOCASE ASC`
    );
    return NextResponse.json({ clients: rows });
  } catch (err) {
    console.error('[GET /api/client-interactions/internal-clients]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
