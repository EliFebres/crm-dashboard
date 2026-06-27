export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, queryWrite, executeTransaction, hasDb } from '@/app/lib/db';
import { rowToEngagement, CLIENT_JOIN } from '@/app/lib/db/queries';
import { requireAuth, teamConstraint, canModify, readOnlyError, canEditEngagement, notTeamMemberError } from '@/app/lib/auth/require-auth';
import { normalizeCrn } from '@/app/lib/config/crn';
import { toISODate } from '@/app/lib/db/dateUtils';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

// GET /api/client-interactions/engagements/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    const { id } = await params;
    const teamClause = sc.team ? 'AND e.team = ?' : '';
    const teamParams = sc.team ? [sc.team] : [];
    const rows = await query<Record<string, unknown>>(
      `SELECT e.*, c.name AS client_name FROM engagements e ${CLIENT_JOIN} WHERE e.id = ? ${teamClause}`,
      [Number(id), ...teamParams]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    return NextResponse.json(rowToEngagement(rows[0]));
  } catch (err) {
    console.error('GET /api/client-interactions/engagements/[id] error:', err);
    return NextResponse.json({ error: 'Failed to fetch engagement' }, { status: 500 });
  }
}

// PATCH /api/client-interactions/engagements/:id
// Body: partial engagement fields (camelCase) — only provided fields are updated
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();
  const sc = teamConstraint(auth.payload);

  try {
    const { id } = await params;
    const engagementId = Number(id);
    const body = await req.json();

    // Team-member gate: only users on the engagement's current team_members list
    // (or admins) may edit. Check the stored value, not anything in the body, so
    // a non-member can't add themselves and then mutate.
    const teamRows = await query<{ team_members: string }>(
      `SELECT team_members FROM engagements WHERE id = ?`,
      [engagementId]
    );
    if (teamRows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    const currentTeamMembers = JSON.parse(teamRows[0].team_members || '[]') as string[];
    if (!canEditEngagement(auth.payload, currentTeamMembers)) return notTeamMemberError();

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (body.clientCrn !== undefined) {
      const crn = body.clientCrn ? normalizeCrn(String(body.clientCrn)) : '';
      if (!crn) {
        return NextResponse.json({ error: 'Client CRN is required' }, { status: 400 });
      }
      const exists = await query<{ crn: string }>(`SELECT crn FROM clients WHERE crn = ?`, [crn]);
      if (exists.length === 0) {
        return NextResponse.json({ error: 'Unknown client CRN' }, { status: 400 });
      }
      setClauses.push('client_crn = ?');
      values.push(crn);
    }
    if (body.internalClient !== undefined) {
      setClauses.push('internal_client_name = ?', 'internal_client_dept = ?');
      values.push(body.internalClient.name, body.internalClient.gcgDepartment);
    }
    if (body.intakeType !== undefined) {
      setClauses.push('intake_type = ?');
      values.push(body.intakeType);
    }
    if (body.adHocChannel !== undefined) {
      setClauses.push('ad_hoc_channel = ?');
      values.push(body.adHocChannel ?? null);
    }
    if (body.type !== undefined) {
      setClauses.push('type = ?');
      values.push(body.type);
    }
    if (body.teamMembers !== undefined) {
      setClauses.push('team_members = ?');
      values.push(JSON.stringify(body.teamMembers));
    }
    if (body.dateStarted !== undefined) {
      setClauses.push('date_started = ?');
      values.push(toISODate(body.dateStarted));
    }
    if (body.dateFinished !== undefined) {
      setClauses.push('date_finished = ?');
      values.push(toISODate(body.dateFinished));
    }
    if (body.status !== undefined) {
      setClauses.push('status = ?');
      values.push(body.status);
    }
    if (body.portfolioLogged !== undefined) {
      setClauses.push('portfolio_logged = ?');
      values.push(Boolean(body.portfolioLogged));
    }
    if (body.portfolio !== undefined) {
      setClauses.push('portfolio = ?');
      values.push(body.portfolio ? JSON.stringify(body.portfolio) : null);
    }
    if (body.nna !== undefined) {
      setClauses.push('nna = ?');
      values.push(body.nna ?? null);
    }
    if (body.notes !== undefined) {
      setClauses.push('notes = ?');
      values.push(body.notes ?? null);
    }
    if (body.tickersMentioned !== undefined) {
      setClauses.push('tickers_mentioned = ?');
      values.push(body.tickersMentioned ? JSON.stringify(body.tickersMentioned) : null);
    }
    if (body.linkedFromId !== undefined) {
      // null explicitly clears the link; a number sets/changes it
      if (body.linkedFromId === null) {
        setClauses.push('linked_from_id = ?');
        values.push(null);
      } else {
        const n = Number(body.linkedFromId);
        if (!Number.isFinite(n) || n <= 0) {
          return NextResponse.json({ error: 'Invalid linkedFromId' }, { status: 400 });
        }
        if (n === engagementId) {
          return NextResponse.json({ error: 'Cannot link an engagement to itself' }, { status: 400 });
        }
        // Parent must exist in the same team
        const parentTeamClause = sc.team ? 'AND team = ?' : '';
        const parentParams: unknown[] = [n];
        if (sc.team) parentParams.push(sc.team);
        const parent = await query<{ id: number }>(
          `SELECT id FROM engagements WHERE id = ? ${parentTeamClause}`,
          parentParams
        );
        if (parent.length === 0) {
          return NextResponse.json({ error: 'Linked engagement not found' }, { status: 400 });
        }
        setClauses.push('linked_from_id = ?');
        values.push(n);
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Always bump version for optimistic locking
    setClauses.push('version = version + 1');

    // If client sends version, enforce it to detect concurrent edits
    const clientVersion = typeof body.version === 'number' ? body.version : null;
    const teamClause = sc.team ? 'AND team = ?' : '';
    const whereClause = clientVersion !== null
      ? `WHERE id = ? AND version = ? ${teamClause}`
      : `WHERE id = ? ${teamClause}`;
    values.push(engagementId);
    if (clientVersion !== null) values.push(clientVersion);
    if (sc.team) values.push(sc.team);

    const updated = await queryWrite<Record<string, unknown>>(
      `UPDATE engagements SET ${setClauses.join(', ')} ${whereClause} RETURNING id`,
      values
    );

    if (updated.length === 0) {
      const exists = await query<{ id: number }>(`SELECT id FROM engagements WHERE id = ?`, [engagementId]);
      if (exists.length === 0) {
        return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
      }
      return NextResponse.json(
        { error: 'This engagement was modified by someone else. Refresh and try again.' },
        { status: 409 }
      );
    }

    const rows = await query<Record<string, unknown>>(
      `SELECT e.*, c.name AS client_name FROM engagements e ${CLIENT_JOIN} WHERE e.id = ?`,
      [engagementId]
    );
    emitEngagementChange('updated');
    const changedFields = Object.keys(body).filter(k => k !== 'version' && k !== 'id');
    const internalClient = (rows[0].internal_client_name as string | null) ?? null;
    void logActivity(req, {
      action: 'engagement.update',
      entityType: 'engagement',
      entityId: engagementId,
      details: { fields: changedFields, internalClient },
    });
    return NextResponse.json(rowToEngagement(rows[0]));
  } catch (err) {
    console.error('PATCH /api/client-interactions/engagements/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update engagement' }, { status: 500 });
  }
}

// DELETE /api/client-interactions/engagements/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();
  const sc = teamConstraint(auth.payload);

  try {
    const { id } = await params;
    const engagementId = Number(id);

    // Only assigned Team Members (or admins) may delete.
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
    // Capture internalClient for the activity log before the row is gone.
    const preDelete = await query<{ internal_client_name: string | null }>(
      `SELECT internal_client_name FROM engagements WHERE id = ?`,
      [engagementId]
    );
    const internalClient = preDelete[0]?.internal_client_name ?? null;

    // Null out any children's link, then delete — in one transaction so we don't leave orphans.
    await executeTransaction((tx) => {
      tx.run(`UPDATE engagements SET linked_from_id = NULL WHERE linked_from_id = ?`, [engagementId]);
      tx.run(
        `DELETE FROM engagements WHERE id = ? ${teamClause}`,
        [engagementId, ...teamParams]
      );
    });
    emitEngagementChange('deleted');
    void logActivity(req, {
      action: 'engagement.delete',
      entityType: 'engagement',
      entityId: engagementId,
      details: { internalClient },
    });
    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('DELETE /api/client-interactions/engagements/[id] error:', err);
    return NextResponse.json({ error: 'Failed to delete engagement' }, { status: 500 });
  }
}
