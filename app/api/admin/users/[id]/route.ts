export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { queryUsers, executeUsers } from '@/app/lib/db/users';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { rowToUser, toDisplayName } from '@/app/lib/auth/types';
import { emitUserChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';
import { titleExists } from '@/app/lib/db/titles';

const VALID_STATUSES = ['pending', 'active', 'inactive'];
const VALID_ROLES = ['user', 'admin'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    let payload;
    try {
      payload = await verifyJWT(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }

    if (payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const { id } = await params;

    // Fetch target user
    const rows = await queryUsers('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const body = await req.json();
    const { status, role, title } = body;

    // Identify the founding account (earliest created_at) — their admin can only be
    // removed by themselves, not by any other admin.
    const founderRows = await queryUsers<{ id: string }>(
      'SELECT id FROM users ORDER BY created_at ASC LIMIT 1'
    );
    const founderId = (founderRows[0] as Record<string, unknown>)?.id as string | undefined;
    const isTargetFounder = founderId !== undefined && id === founderId;
    const isRequesterFounder = founderId !== undefined && payload.sub === founderId;

    // Block any admin from removing the founder's admin privileges (except the founder themselves)
    if (role === 'user' && isTargetFounder && !isRequesterFounder) {
      return NextResponse.json(
        { error: 'The founding account\'s admin privileges can only be removed by the account holder.' },
        { status: 403 }
      );
    }

    // Safety: block self-deactivation; block self-demotion unless the requester is the founder
    if (payload.sub === id) {
      if (status === 'inactive') {
        return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 });
      }
      if (role === 'user' && !isRequesterFounder) {
        return NextResponse.json({ error: 'You cannot remove admin from your own account.' }, { status: 400 });
      }
    }

    // Validate provided fields
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status value.' }, { status: 400 });
    }
    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role value.' }, { status: 400 });
    }
    if (title !== undefined && !(await titleExists(title))) {
      return NextResponse.json({ error: 'Invalid title value.' }, { status: 400 });
    }

    const sets: string[] = [];
    const values: unknown[] = [];

    if (status !== undefined) {
      sets.push('status = ?');
      values.push(status);
      if (status === 'active') {
        sets.push('approved_at = CURRENT_TIMESTAMP');
        sets.push('approved_by_id = ?');
        values.push(payload.sub);
      }
    }
    if (role !== undefined) {
      sets.push('role = ?');
      values.push(role);
    }
    if (title !== undefined) {
      sets.push('title = ?');
      values.push(title);
    }

    if (sets.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    values.push(id);
    await executeUsers(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);

    const updated = await queryUsers('SELECT * FROM users WHERE id = ?', [id]);
    const user = rowToUser(updated[0] as Record<string, unknown>);

    // Auto-link: when a user is approved, try to match them to an unlinked team member
    if (status === 'active') {
      const displayName = toDisplayName(user.firstName, user.lastName);
      const matches = await queryUsers(
        `SELECT id FROM team_members WHERE display_name = ? AND team = ? AND user_id IS NULL`,
        [displayName, user.team]
      );
      if (matches.length === 1) {
        const tm = matches[0] as Record<string, unknown>;
        await executeUsers(`UPDATE team_members SET user_id = ? WHERE id = ?`, [user.id, tm.id]);
      }
    }

    void logActivity(req, {
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      details: {
        targetEmail: user.email,
        status: status ?? undefined,
        role: role ?? undefined,
        title: title ?? undefined,
      },
    });

    return NextResponse.json(user, { status: 200 });
  } catch (err) {
    console.error('[PATCH /api/admin/users/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    let payload;
    try {
      payload = await verifyJWT(token);
    } catch {
      return NextResponse.json({ error: 'Invalid or expired session.' }, { status: 401 });
    }

    if (payload.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    const { id } = await params;

    const rows = await queryUsers('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const target = rows[0] as Record<string, unknown>;

    if (target.status !== 'pending') {
      return NextResponse.json({ error: 'Only pending accounts can be deleted.' }, { status: 400 });
    }

    if (payload.sub === id) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    }

    await executeUsers('DELETE FROM users WHERE id = ?', [id]);
    emitUserChange('deleted');
    void logActivity(req, {
      action: 'user.delete',
      entityType: 'user',
      entityId: id,
      details: { targetEmail: target.email as string },
    });

    return new Response(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /api/admin/users/[id]]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
