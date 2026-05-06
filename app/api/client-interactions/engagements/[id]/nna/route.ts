export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { execute, query } from '@/app/lib/db';
import { requireAuth, teamConstraint, canModify, readOnlyError, canEditEngagement, notTeamMemberError } from '@/app/lib/auth/require-auth';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

// PATCH /api/client-interactions/engagements/:id/nna
// Body: { nna: number | null }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!process.env.DUCKDB_DIR) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();
  const sc = teamConstraint(auth.payload);

  try {
    const { id } = await params;
    const engagementId = Number(id);
    const { nna } = await req.json();

    if (nna !== null && nna !== undefined) {
      if (typeof nna !== 'number' || !isFinite(nna) || nna < 0) {
        return NextResponse.json({ error: 'NNA must be a non-negative number' }, { status: 400 });
      }
    }

    const teamRows = await query<{ team_members: string }>(
      `SELECT team_members FROM engagements WHERE id = ?`,
      [engagementId]
    );
    if (teamRows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    const currentTeamMembers = JSON.parse(teamRows[0].team_members || '[]') as string[];
    if (!canEditEngagement(auth.payload, currentTeamMembers)) return notTeamMemberError();

    const teamClause = sc.team ? 'AND team = ?' : '';
    const teamParams = sc.team ? [sc.team] : [];

    await execute(
      `UPDATE engagements SET nna = ? WHERE id = ? ${teamClause}`,
      [nna ?? null, engagementId, ...teamParams]
    );

    emitEngagementChange('updated');
    const clientRows = await query<{ internal_client_name: string | null }>(
      `SELECT internal_client_name FROM engagements WHERE id = ?`,
      [engagementId]
    );
    void logActivity(req, {
      action: 'engagement.nna_change',
      entityType: 'engagement',
      entityId: engagementId,
      details: { nna: nna ?? null, internalClient: clientRows[0]?.internal_client_name ?? null },
    });
    return NextResponse.json({ id: engagementId, nna: nna ?? undefined });
  } catch (err) {
    console.error('PATCH .../nna error:', err);
    return NextResponse.json({ error: 'Failed to update NNA' }, { status: 500 });
  }
}
