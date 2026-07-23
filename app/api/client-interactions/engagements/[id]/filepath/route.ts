export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, queryWrite, hasDb } from '@/app/lib/db';
import { rowToEngagement, CLIENT_JOIN } from '@/app/lib/db/queries';
import { requireAuth, teamConstraint, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { teamScopeClause } from '@/app/lib/db/queries';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

const MAX_FILEPATH_LENGTH = 1000;

// PATCH /api/client-interactions/engagements/:id/filepath
// Body: { filepath: string | null }
// Any authenticated, non-read-only user may set this — no team-member gate.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();
  const sc = teamConstraint(auth.payload);

  try {
    const { id } = await params;
    const engagementId = Number(id);
    const body = await req.json();

    if (!('filepath' in body)) {
      return NextResponse.json({ error: 'filepath is required.' }, { status: 400 });
    }

    const raw = body.filepath;
    let next: string | null;
    if (raw === null) {
      next = null;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        next = null;
      } else if (trimmed.length > MAX_FILEPATH_LENGTH) {
        return NextResponse.json(
          { error: `filepath exceeds ${MAX_FILEPATH_LENGTH} characters.` },
          { status: 400 }
        );
      } else {
        next = trimmed;
      }
    } else {
      return NextResponse.json({ error: 'filepath must be a string or null.' }, { status: 400 });
    }

    const { clause: teamClause, params: teamParams } = teamScopeClause(sc);

    const updated = await queryWrite<{ id: number }>(
      `UPDATE engagements SET filepath = ?, version = version + 1 WHERE id = ? ${teamClause} RETURNING id`,
      [next, engagementId, ...teamParams]
    );

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT e.*, c.name AS client_name FROM engagements e ${CLIENT_JOIN} WHERE e.id = ?`,
      [engagementId]
    );

    emitEngagementChange('updated');
    const internalClient = (rows[0].internal_client_name as string | null) ?? null;
    void logActivity(req, {
      action: 'engagement.filepath.update',
      entityType: 'engagement',
      entityId: engagementId,
      details: { internalClient, cleared: next === null },
    });

    return NextResponse.json(rowToEngagement(rows[0]));
  } catch (err) {
    console.error('PATCH .../filepath error:', err);
    return NextResponse.json({ error: 'Failed to update filepath' }, { status: 500 });
  }
}
