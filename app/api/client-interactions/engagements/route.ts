export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, queryWrite, hasDb } from '@/app/lib/db';
import { rowToEngagement } from '@/app/lib/db/queries';
import { computeEngagementsList } from '@/app/lib/db/aggregations';
import { requireAuth, teamConstraint, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { toISODate } from '@/app/lib/db/dateUtils';
import type { EngagementFilters, SortSpec } from '@/app/lib/api/client-interactions';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

// Parses repeated `sort=col:dir` params into a SortSpec[] (preserves order).
function parseSortParams(sp: URLSearchParams): SortSpec[] {
  return sp.getAll('sort').reduce<SortSpec[]>((acc, raw) => {
    const [column, dir] = raw.split(':');
    if (column && (dir === 'asc' || dir === 'desc')) {
      acc.push({ column, direction: dir });
    }
    return acc;
  }, []);
}

// GET /api/client-interactions/engagements
// Query params: page, page_size, period, search, team_member, status,
//               sort=col:dir (repeatable), departments[], intake_types[], project_types[]
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    const sp = req.nextUrl.searchParams;
    const filters: EngagementFilters = {
      page: Number(sp.get('page') || 1),
      pageSize: Number(sp.get('page_size') || 50),
      period: sp.get('period') || undefined,
      search: sp.get('search') || undefined,
      teamMember: sp.get('team_member') || undefined,
      status: sp.get('status') || undefined,
      sortBy: parseSortParams(sp),
      departments: sp.getAll('departments').filter(Boolean),
      intakeTypes: sp.getAll('intake_types').filter(Boolean),
      projectTypes: sp.getAll('project_types').filter(Boolean),
    };

    const result = await computeEngagementsList(filters, sc);
    return NextResponse.json(result);
  } catch (err) {
    console.error('GET /api/client-interactions/engagements error:', err);
    return NextResponse.json({ error: 'Failed to fetch engagements' }, { status: 500 });
  }
}

// POST /api/client-interactions/engagements
// Body: engagement fields (camelCase)
export async function POST(req: NextRequest) {
  if (!hasDb()) {
    return NextResponse.json({ error: 'Database not configured. Set SQLITE_DIR to enable write operations.' }, { status: 503 });
  }
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (!canModify(auth.payload)) return readOnlyError();

  try {
    const body = await req.json();

    const department = body.internalClient?.gcgDepartment ?? body.department ?? '';

    // Validate linkedFromId (if provided): must be a number and point to an engagement in the same team
    let linkedFromId: number | null = null;
    if (body.linkedFromId != null) {
      const n = Number(body.linkedFromId);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'Invalid linkedFromId' }, { status: 400 });
      }
      const parent = await query<{ id: number }>(
        `SELECT id FROM engagements WHERE id = ? AND team = ?`,
        [n, auth.payload.team]
      );
      if (parent.length === 0) {
        return NextResponse.json({ error: 'Linked engagement not found' }, { status: 400 });
      }
      linkedFromId = n;
    }

    const insertRows = await queryWrite<{ id: number }>(
      `INSERT INTO engagements (
        external_client, internal_client_name, internal_client_dept,
        intake_type, ad_hoc_channel, type, team_members, department,
        date_started, date_finished, status, portfolio_logged, portfolio,
        nna, notes, tickers_mentioned, team, created_by_id, created_by_name,
        linked_from_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`,
      [
        body.externalClient ?? null,
        body.internalClient?.name ?? null,
        body.internalClient?.gcgDepartment ?? null,
        body.intakeType,
        body.adHocChannel ?? null,
        body.type,
        JSON.stringify(body.teamMembers || []),
        department,
        toISODate(body.dateStarted),
        toISODate(body.dateFinished),
        body.status,
        body.portfolioLogged ? true : false,
        body.portfolio ? JSON.stringify(body.portfolio) : null,
        body.nna ?? null,
        body.notes ?? null,
        body.tickersMentioned ? JSON.stringify(body.tickersMentioned) : null,
        auth.payload.team,
        auth.payload.sub,
        `${auth.payload.firstName} ${auth.payload.lastName}`,
        linkedFromId,
      ]
    );
    const id = Number(insertRows[0].id);

    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM engagements WHERE id = ?`,
      [id]
    );

    emitEngagementChange('created');
    void logActivity(req, {
      action: 'engagement.create',
      entityType: 'engagement',
      entityId: id,
      details: {
        internalClient: body.internalClient?.name ?? null,
        department,
        intakeType: body.intakeType,
        type: body.type,
        status: body.status,
      },
    });
    return NextResponse.json(rowToEngagement(rows[0]), { status: 201 });
  } catch (err) {
    console.error('POST /api/client-interactions/engagements error:', err);
    return NextResponse.json({ error: 'Failed to create engagement' }, { status: 500 });
  }
}
