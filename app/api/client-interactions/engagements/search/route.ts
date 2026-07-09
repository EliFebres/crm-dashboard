export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/app/lib/db';
import { CLIENT_JOIN } from '@/app/lib/db/queries';
import { requireAuth, teamConstraint } from '@/app/lib/auth/require-auth';
import { toDisplayDate } from '@/app/lib/db/dateUtils';
import type { EngagementLinkSummary } from '@/app/lib/types/engagements';

// GET /api/client-interactions/engagements/search
// Slim engagement list for the "link previous interaction" picker.
// Params: q (fuzzy), client (internal client name), excludeId, id (exact id lookup), limit
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get('q')?.trim() || '';
    const client = sp.get('client')?.trim() || '';
    const excludeId = sp.get('excludeId');
    const id = sp.get('id');
    const limit = Math.min(Number(sp.get('limit') || 20), 50);

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Unassigned engagements (team IS NULL) are searchable by everyone.
    if (sc.team) {
      conditions.push('(e.team = ? OR e.team IS NULL)');
      params.push(sc.team);
    }

    // Exact id lookup (used to rehydrate the preview chip on form open)
    if (id) {
      const n = Number(id);
      if (Number.isFinite(n)) {
        conditions.push('e.id = ?');
        params.push(n);
      }
    }

    if (excludeId) {
      const n = Number(excludeId);
      if (Number.isFinite(n)) {
        conditions.push('e.id != ?');
        params.push(n);
      }
    }

    if (client) {
      conditions.push('e.internal_client_name = ?');
      params.push(client);
    }

    if (q) {
      const s = `%${q.toLowerCase()}%`;
      conditions.push(`(
        lower(c.name) LIKE ?
        OR lower(e.client_crn) LIKE ?
        OR lower(e.internal_client_name) LIKE ?
        OR lower(e.intake_type) LIKE ?
        OR lower(e.type) LIKE ?
        OR CAST(e.id AS VARCHAR) LIKE ?
      )`);
      params.push(s, s, s, s, s, s);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query<Record<string, unknown>>(
      `SELECT e.id, e.date_started, e.type, e.intake_type, e.internal_client_name, e.internal_client_dept,
              e.client_crn, c.name AS client_name
       FROM engagements e
       ${CLIENT_JOIN}
       ${where}
       ORDER BY e.date_started DESC, e.id DESC
       LIMIT ${limit}`,
      params
    );

    const results: EngagementLinkSummary[] = rows.map((row) => ({
      id: Number(row.id),
      dateStarted: toDisplayDate(row.date_started as string),
      type: row.type as string,
      intakeType: row.intake_type as string,
      internalClientName: row.internal_client_name as string,
      internalClientDept: row.internal_client_dept as string,
      clientCrn: (row.client_crn as string | null) ?? '',
      externalClient: (row.client_name as string | null) ?? '',
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error('GET /api/client-interactions/engagements/search error:', err);
    return NextResponse.json({ error: 'Failed to search engagements' }, { status: 500 });
  }
}
