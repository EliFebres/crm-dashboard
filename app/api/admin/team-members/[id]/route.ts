export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { queryUsers, executeUsers } from '@/app/lib/db/users';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { rowToTeamMember } from '@/app/lib/auth/types';
import { logActivity } from '@/app/lib/activity/log';

const VALID_OFFICES = ['Office B', 'Office A', 'Office C', 'Office D', 'Office E'];

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const payload = await requireAdmin(req);
    if (!payload) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const { id } = await params;

    const rows = await queryUsers(`SELECT * FROM team_members WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Team member not found.' }, { status: 404 });
    }

    const body = await req.json();
    const { status, userId, office } = body as { status?: string; userId?: string | null; office?: string };

    const sets: string[] = [];
    const values: unknown[] = [];

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
      }
      sets.push('status = ?');
      values.push(status);
    }

    if ('userId' in body) {
      if (userId !== null) {
        // Verify the user exists
        const userRows = await queryUsers(`SELECT id FROM users WHERE id = ?`, [userId]);
        if (userRows.length === 0) {
          return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }
        // Ensure this user isn't already linked to another team member on the same team
        const tm = rows[0] as Record<string, unknown>;
        const conflict = await queryUsers(
          `SELECT id FROM team_members WHERE user_id = ? AND team = ? AND id != ?`,
          [userId, tm.team, id]
        );
        if (conflict.length > 0) {
          return NextResponse.json(
            { error: 'This user is already linked to another team member on the same team.' },
            { status: 409 }
          );
        }
      }
      sets.push('user_id = ?');
      values.push(userId ?? null);
    }

    if (office !== undefined) {
      if (!VALID_OFFICES.includes(office)) {
        return NextResponse.json({ error: 'Invalid office.' }, { status: 400 });
      }
      sets.push('office = ?');
      values.push(office);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    values.push(id);
    await executeUsers(`UPDATE team_members SET ${sets.join(', ')} WHERE id = ?`, values);

    const updated = await queryUsers(`SELECT * FROM team_members WHERE id = ?`, [id]);
    void logActivity(req, {
      action: 'team_member.update',
      entityType: 'team_member',
      entityId: id,
      details: { status, userId, office },
    });
    return NextResponse.json(rowToTeamMember(updated[0] as Record<string, unknown>));
  } catch (err) {
    console.error('[PATCH /api/admin/team-members/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
