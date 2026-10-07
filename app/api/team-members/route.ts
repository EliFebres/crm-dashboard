export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { queryUsers } from '@/app/lib/db/users';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { rowToTeamMember } from '@/app/lib/auth/types';

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    try {
      await verifyJWT(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const team = searchParams.get('team');
    // all=1: every team's active members, so an interaction can be shared across teams.
    const all = searchParams.get('all') === '1';
    if (!team && !all) {
      return NextResponse.json({ error: 'team (or all=1) query parameter is required.' }, { status: 400 });
    }

    const rows = all
      ? await queryUsers(
          `SELECT * FROM team_members WHERE status = 'active' ORDER BY team, office, last_name, first_name`
        )
      : await queryUsers(
          `SELECT * FROM team_members WHERE team = ? AND status = 'active' ORDER BY office, last_name, first_name`,
          [team]
        );

    return NextResponse.json(rows.map(r => rowToTeamMember(r as Record<string, unknown>)));
  } catch (err) {
    console.error('[GET /api/team-members]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
