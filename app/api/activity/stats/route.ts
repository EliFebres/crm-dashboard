export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/auth/require-auth';
import { queryActivity } from '@/app/lib/db/activity';
import { queryUsers } from '@/app/lib/db/users';

type Range = '24h' | '7d' | '30d';

// Returns a SQLite datetime() modifier for the selected range.
function rangeToInterval(range: Range): string {
  switch (range) {
    case '24h': return '-1 day';
    case '30d': return '-30 days';
    case '7d':
    default: return '-7 days';
  }
}

// GET /api/activity/stats?range=7d (admin-only)
// Returns aggregates for the activity dashboard metric cards, usage breakdown,
// and a per-day timeseries.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (auth.payload.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const range = (req.nextUrl.searchParams.get('range') as Range) || '7d';
    const interval = rangeToInterval(range);

    // User totals
    const userTotals = await queryUsers<{ total: number; active: number; pending: number; inactive: number }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'active')   AS active,
         COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
         COUNT(*) FILTER (WHERE status = 'inactive') AS inactive
       FROM users`
    );

    const signupsThisWeek = await queryUsers<{ count: number }>(
      `SELECT COUNT(*) AS count FROM users WHERE created_at >= datetime('now', '-7 days')`
    );

    // Event counts
    const eventsToday = await queryActivity<{ count: number }>(
      `SELECT COUNT(*) AS count FROM activity_logs WHERE date(timestamp) >= date('now')`
    );
    const eventsYesterday = await queryActivity<{ count: number }>(
      `SELECT COUNT(*) AS count FROM activity_logs
       WHERE date(timestamp) >= date('now', '-1 day')
         AND date(timestamp) <  date('now')`
    );

    // Online now
    const onlineNow = await queryActivity<{ count: number }>(
      `SELECT COUNT(*) AS count FROM user_presence WHERE last_seen >= datetime('now', '-5 minutes')`
    );

    // Per-category breakdown over selected range.
    // Categories are synthesized from action so that create/update/delete on
    // engagements appear as distinct slices in the pie chart.
    const byEntity = await queryActivity<{ entity_type: string | null; count: number }>(
      `SELECT
         CASE
           WHEN action IN ('engagement.create', 'engagement.bulk_upload') THEN 'interaction_created'
           WHEN action = 'engagement.delete' THEN 'interaction_deleted'
           WHEN action LIKE 'engagement.%' THEN 'interaction_updated'
           WHEN action LIKE 'note.%' THEN 'interaction_updated'
           WHEN action LIKE 'user.%' THEN 'user'
           WHEN action LIKE 'team_member.%' THEN 'team_member'
           WHEN action LIKE 'page.%' THEN 'page'
           ELSE 'other'
         END AS entity_type,
         COUNT(*) AS count
       FROM activity_logs
       WHERE datetime(timestamp) >= datetime('now', '${interval}')
       GROUP BY 1
       ORDER BY count DESC`
    );

    // Per-action breakdown over selected range (top 10)
    const byAction = await queryActivity<{ action: string; count: number }>(
      `SELECT action, COUNT(*) AS count
       FROM activity_logs
       WHERE datetime(timestamp) >= datetime('now', '${interval}')
       GROUP BY action
       ORDER BY count DESC
       LIMIT 10`
    );

    // Per-day timeseries over selected range
    const byDay = await queryActivity<{ day: string; count: number }>(
      `SELECT date(timestamp) AS day, COUNT(*) AS count
       FROM activity_logs
       WHERE datetime(timestamp) >= datetime('now', '${interval}')
       GROUP BY 1
       ORDER BY 1 ASC`
    );

    // Per-day page.view timeseries split by path (for Activity by Page chart)
    const byDayByPage = await queryActivity<{ day: string; path: string | null; count: number }>(
      `SELECT
         date(timestamp) AS day,
         entity_id AS path,
         COUNT(*) AS count
       FROM activity_logs
       WHERE action = 'page.view'
         AND datetime(timestamp) >= datetime('now', '${interval}')
       GROUP BY 1, 2
       ORDER BY 1 ASC`
    );

    // Most active users over selected range (top 5)
    const topUsers = await queryActivity<{ user_name: string | null; user_email: string | null; count: number }>(
      `SELECT user_name, user_email, COUNT(*) AS count
       FROM activity_logs
       WHERE datetime(timestamp) >= datetime('now', '${interval}')
         AND user_id IS NOT NULL
       GROUP BY user_name, user_email
       ORDER BY count DESC
       LIMIT 5`
    );

    return NextResponse.json({
      range,
      users: {
        total: Number(userTotals[0]?.total ?? 0),
        active: Number(userTotals[0]?.active ?? 0),
        pending: Number(userTotals[0]?.pending ?? 0),
        inactive: Number(userTotals[0]?.inactive ?? 0),
        signupsThisWeek: Number(signupsThisWeek[0]?.count ?? 0),
      },
      events: {
        today: Number(eventsToday[0]?.count ?? 0),
        yesterday: Number(eventsYesterday[0]?.count ?? 0),
      },
      onlineNow: Number(onlineNow[0]?.count ?? 0),
      byEntity: byEntity.map(r => ({ entityType: r.entity_type, count: Number(r.count) })),
      byAction: byAction.map(r => ({ action: r.action, count: Number(r.count) })),
      byDay: byDay.map(r => ({ day: r.day, count: Number(r.count) })),
      byDayByPage: byDayByPage.map(r => ({
        day: r.day,
        path: r.path ?? 'unknown',
        count: Number(r.count),
      })),
      topUsers: topUsers.map(r => ({
        userName: r.user_name,
        userEmail: r.user_email,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    console.error('GET /api/activity/stats error:', err);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
