export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/auth/require-auth';
import { queryActivity } from '@/app/lib/db/activity';

// GET /api/activity — paginated activity log rows (admin-only)
// Query params: page, page_size, action, user, since, until, search
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (auth.payload.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page') || 1));
    const pageSize = Math.min(200, Math.max(1, Number(sp.get('page_size') || 50)));
    const offset = (page - 1) * pageSize;

    const where: string[] = [];
    const params: unknown[] = [];

    const action = sp.get('action');
    if (action) {
      where.push('action = ?');
      params.push(action);
    }

    const entityType = sp.get('entity_type');
    if (entityType) {
      where.push('entity_type = ?');
      params.push(entityType);
    }

    const userId = sp.get('user_id');
    if (userId) {
      where.push('user_id = ?');
      params.push(userId);
    }

    const since = sp.get('since');
    if (since) {
      where.push('timestamp >= ?');
      params.push(since);
    }

    const until = sp.get('until');
    if (until) {
      where.push('timestamp <= ?');
      params.push(until);
    }

    const search = sp.get('search');
    if (search) {
      where.push('(user_email LIKE ? OR user_name LIKE ? OR action LIKE ? OR CAST(details AS TEXT) LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRows = await queryActivity<{ count: number }>(
      `SELECT COUNT(*) AS count FROM activity_logs ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.count ?? 0);

    const rows = await queryActivity<Record<string, unknown>>(
      `SELECT * FROM activity_logs ${whereSql}
       ORDER BY timestamp DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );

    const logs = rows.map(r => ({
      id: r.id,
      timestamp: String(r.timestamp),
      userId: r.user_id,
      userEmail: r.user_email,
      userName: r.user_name,
      userOffice: r.user_office ?? null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      details: r.details ? JSON.parse(r.details as string) : null,
      ip: r.ip,
      userAgent: r.user_agent,
    }));

    return NextResponse.json({ logs, total, page, pageSize });
  } catch (err) {
    console.error('GET /api/activity error:', err);
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
  }
}
