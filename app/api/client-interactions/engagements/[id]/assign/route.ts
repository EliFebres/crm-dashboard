export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, queryWrite, hasDb } from '@/app/lib/db';
import { queryUsers } from '@/app/lib/db/users';
import { teamScopeClause } from '@/app/lib/db/queries';
import {
  requireAuth,
  teamConstraint,
  canModify,
  readOnlyError,
  canEditEngagement,
  notTeamMemberError,
} from '@/app/lib/auth/require-auth';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

// PATCH /api/client-interactions/engagements/:id/assign
// Body: { teamMembers: string[], version?: number }
//
// Staffs (or un-staffs) an engagement, and derives engagements.team from whoever
// ends up assigned. This is the one write path that can set `team` — the generic
// PATCH deliberately cannot — because claiming an unassigned interaction has to move
// both fields at once or the row would stay stranded in the global inbox.
//
// An engagement with team = NULL and team_members = [] is UNASSIGNED: visible to
// every user, claimable by any of them. That is how automated jobs (backend/crm_sync)
// hand work over to the department. Passing an empty teamMembers array returns an
// engagement to that inbox.
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
    if (!Number.isFinite(engagementId)) {
      return NextResponse.json({ error: 'Invalid engagement id' }, { status: 400 });
    }

    const body = await req.json();
    const { teamMembers, version } = body as { teamMembers?: unknown; version?: unknown };

    if (!Array.isArray(teamMembers) || teamMembers.some(m => typeof m !== 'string')) {
      return NextResponse.json({ error: 'teamMembers must be an array of names.' }, { status: 400 });
    }
    // Trim, drop blanks, de-dupe — the roster is a set, and a stray '' would never
    // match a display_name and would silently render as a blank avatar.
    const requested = [...new Set((teamMembers as string[]).map(m => m.trim()).filter(Boolean))];

    // Load the row, scoped to what the caller may see (their team, or unassigned).
    const { clause: teamClause, params: teamParams } = teamScopeClause(sc);
    const rows = await query<{ team_members: string; team: string | null }>(
      `SELECT team_members, team FROM engagements WHERE id = ? ${teamClause}`,
      [engagementId, ...teamParams]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }
    const currentTeamMembers = JSON.parse(rows[0].team_members || '[]') as string[];

    // Empty roster ⇒ anyone may claim it. Non-empty ⇒ assignees + admins only.
    if (!canEditEngagement(auth.payload, currentTeamMembers)) return notTeamMemberError();

    // Resolve every requested name against the live roster. An unrecognized name would
    // produce an engagement nobody can edit, so reject rather than store it.
    let nextTeam: string | null = null;
    if (requested.length > 0) {
      const placeholders = requested.map(() => '?').join(', ');
      const resolved = await queryUsers<{ display_name: string; team: string }>(
        `SELECT display_name, team FROM team_members
         WHERE display_name IN (${placeholders}) AND status = 'active'`,
        requested
      );
      const found = new Set(resolved.map(r => r.display_name));
      const missing = requested.filter(m => !found.has(m));
      if (missing.length > 0) {
        return NextResponse.json(
          { error: `Not an active team member: ${missing.join(', ')}` },
          { status: 400 }
        );
      }

      // The engagement's team follows its assignees. A roster spanning two teams has no
      // single owner, and `team` is a scalar — so refuse rather than pick arbitrarily.
      const teams = [...new Set(resolved.map(r => r.team))];
      if (teams.length > 1) {
        return NextResponse.json(
          { error: `Assignees span multiple teams: ${teams.join(', ')}` },
          { status: 400 }
        );
      }
      nextTeam = teams[0];

      // Anti-grief: without this, any user could shove an inbox item into a stranger's
      // team, where they'd never find it. Admins are trusted to move work across teams.
      if (auth.payload.role !== 'admin' && nextTeam !== auth.payload.team) {
        return NextResponse.json(
          { error: 'You can only assign members of your own team.' },
          { status: 403 }
        );
      }
    }

    // Optimistic locking, matching the generic PATCH: if the client sends the version
    // it read, a concurrent edit makes this match zero rows and we report the conflict.
    const clientVersion = typeof version === 'number' ? version : null;
    const versionClause = clientVersion !== null ? 'AND version = ?' : '';
    const values: unknown[] = [JSON.stringify(requested), nextTeam, engagementId];
    if (clientVersion !== null) values.push(clientVersion);
    values.push(...teamParams);

    const updated = await queryWrite<{ id: number }>(
      `UPDATE engagements
       SET team_members = ?, team = ?, version = version + 1
       WHERE id = ? ${versionClause} ${teamClause}
       RETURNING id`,
      values
    );

    if (updated.length === 0) {
      return NextResponse.json(
        { error: 'This engagement was modified by someone else. Refresh and try again.' },
        { status: 409 }
      );
    }

    emitEngagementChange('updated');
    void logActivity(req, {
      action: 'engagement.assign',
      entityType: 'engagement',
      entityId: engagementId,
      details: { teamMembers: requested, team: nextTeam, previousTeam: rows[0].team },
    });

    return NextResponse.json({ id: engagementId, teamMembers: requested, team: nextTeam });
  } catch (err) {
    console.error('PATCH .../assign error:', err);
    return NextResponse.json({ error: 'Failed to assign engagement' }, { status: 500 });
  }
}
