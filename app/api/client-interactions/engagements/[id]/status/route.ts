export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { execute, query } from '@/app/lib/db';
import { requireAuth, teamConstraint, canModify, readOnlyError, canEditEngagement, notTeamMemberError } from '@/app/lib/auth/require-auth';
import { toDisplayDate } from '@/app/lib/db/dateUtils';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';
import { VALID_STATUSES } from '@/app/lib/statusHelpers';

// PATCH /api/client-interactions/engagements/:id/status
// Body: { status: string }
// Updates status only; date_finished is never modified here.
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
    const { status } = await req.json();

    if (!status || !(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
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
      `UPDATE engagements SET status = ? WHERE id = ? ${teamClause}`,
      [status, engagementId, ...teamParams]
    );

    // Verify the row exists
    const rows = await query<Record<string, unknown>>(
      `SELECT id, status, date_finished, internal_client_name FROM engagements WHERE id = ?`,
      [engagementId]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    emitEngagementChange('updated');
    void logActivity(req, {
      action: 'engagement.status_change',
      entityType: 'engagement',
      entityId: engagementId,
      details: { status, internalClient: (rows[0].internal_client_name as string | null) ?? null },
    });
    return NextResponse.json({
      id: engagementId,
      status,
      dateFinished: toDisplayDate(rows[0].date_finished as string | null),
    });
  } catch (err) {
    console.error('PATCH .../status error:', err);
    return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  }
}
