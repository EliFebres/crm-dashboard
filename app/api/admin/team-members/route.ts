export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { queryUsers, executeUsers } from '@/app/lib/db/users';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { rowToTeamMember, toDisplayName } from '@/app/lib/auth/types';
import type { User } from '@/app/lib/auth/types';
import { randomUUID } from 'crypto';
import { logActivity } from '@/app/lib/activity/log';

const VALID_TEAMS: User['team'][] = [
  'Default Team',
  'Equity Specialist',
  'Fixed Income Specialist',
  'Leadership',
  'Guest',
];
const VALID_OFFICES: User['office'][] = ['Office B', 'Office A', 'Office C', 'Office D', 'Office E'];

async function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = await verifyJWT(token);
    if (payload.role !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    // Join with users table to include linked user email
    const rows = await queryUsers(`
      SELECT tm.*,
             u.email    AS linked_email,
             u.first_name AS linked_first_name,
             u.last_name  AS linked_last_name
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      ORDER BY tm.team, tm.office, tm.last_name, tm.first_name
    `);

    const members = rows.map(r => {
      const raw = r as Record<string, unknown>;
      const base = rowToTeamMember(raw);
      return {
        ...base,
        linkedEmail: raw.linked_email as string | null,
        linkedName: raw.linked_first_name
          ? `${raw.linked_first_name} ${raw.linked_last_name}`
          : null,
      };
    });

    return NextResponse.json(members);
  } catch (err) {
    console.error('[GET /api/admin/team-members]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const body = await req.json();
    const { firstName, lastName, team, office } = body as {
      firstName: string;
      lastName: string;
      team: string;
      office: string;
    };

    if (!firstName?.trim() || !lastName?.trim()) {
      return NextResponse.json({ error: 'First and last name are required.' }, { status: 400 });
    }
    if (!VALID_TEAMS.includes(team as User['team'])) {
      return NextResponse.json({ error: 'Invalid team.' }, { status: 400 });
    }
    if (!VALID_OFFICES.includes(office as User['office'])) {
      return NextResponse.json({ error: 'Invalid office.' }, { status: 400 });
    }

    const displayName = toDisplayName(firstName.trim(), lastName.trim());

    // Collision check: same display name + same team
    const existing = await queryUsers(
      `SELECT id FROM team_members WHERE display_name = ? AND team = ? AND status = 'active'`,
      [displayName, team]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { error: `A team member named "${displayName}" already exists on the ${team} team. Consider using a longer last name format to disambiguate.` },
        { status: 409 }
      );
    }

    const id = randomUUID();
    await executeUsers(
      `INSERT INTO team_members (id, display_name, first_name, last_name, team, office)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, displayName, firstName.trim(), lastName.trim(), team, office]
    );

    const rows = await queryUsers(`SELECT * FROM team_members WHERE id = ?`, [id]);
    void logActivity(req, {
      action: 'team_member.create',
      entityType: 'team_member',
      entityId: id,
      details: { displayName, team, office },
    });
    return NextResponse.json(rowToTeamMember(rows[0] as Record<string, unknown>), { status: 201 });
  } catch (err) {
    console.error('[POST /api/admin/team-members]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
