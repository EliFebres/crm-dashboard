export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { queryUsers, getFounderId } from '@/app/lib/db/users';
import { verifyJWT, SESSION_COOKIE } from '@/app/lib/auth/jwt';
import { rowToUser } from '@/app/lib/auth/types';

export async function GET(req: NextRequest) {
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

    const rows = await queryUsers('SELECT * FROM users WHERE id = ?', [payload.sub]);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'User not found.' }, { status: 401 });
    }

    const row = rows[0] as Record<string, unknown>;
    if (row.status !== 'active') {
      return NextResponse.json({ error: 'Account is not active.' }, { status: 401 });
    }

    const user = { ...rowToUser(row), isFounder: (await getFounderId()) === payload.sub };
    return NextResponse.json(user, { status: 200 });
  } catch (err) {
    console.error('[GET /api/auth/me]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
