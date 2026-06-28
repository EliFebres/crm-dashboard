export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/auth/require-auth';
import { queryActivity } from '@/app/lib/db/activity';

// GET /api/activity/online (admin-only)
// Returns users whose last authenticated request was within the last 5 minutes.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (auth.payload.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const rows = await queryActivity<Record<string, unknown>>(
      `SELECT user_id, user_email, user_name, last_seen
       FROM user_presence
       WHERE last_seen >= datetime('now', '-5 minutes')
       ORDER BY last_seen DESC`
    );

    const users = rows.map(r => ({
      userId: r.user_id as string,
      userEmail: r.user_email as string,
      userName: r.user_name as string,
      lastSeen: String(r.last_seen),
    }));

    return NextResponse.json({ users, count: users.length });
  } catch (err) {
    console.error('GET /api/activity/online error:', err);
    return NextResponse.json({ error: 'Failed to fetch online users' }, { status: 500 });
  }
}
