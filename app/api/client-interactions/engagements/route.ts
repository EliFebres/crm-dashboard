export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { query, queryWrite, hasDb } from '@/app/lib/db';
import { rowToEngagement, CLIENT_JOIN, teamScopeClause } from '@/app/lib/db/queries';
import { computeEngagementsList } from '@/app/lib/db/aggregations';
import { requireAuth, teamConstraint, canModify, readOnlyError } from '@/app/lib/auth/require-auth';
import { normalizeCrn } from '@/app/lib/config/crn';
import { toISODate } from '@/app/lib/db/dateUtils';
import { normalizeProjectId } from '@/app/lib/utils/text';
import type { EngagementFilters, SortSpec } from '@/app/lib/api/client-interactions';
import { emitEngagementChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';
import { ensureInternalClient } from '@/app/lib/db/internalClients';

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

    const department = body.internalClient?.clientDept ?? body.department ?? '';

    // Client (external) is required and must reference a registered CRN.
    const clientCrn = body.clientCrn ? normalizeCrn(String(body.clientCrn)) : '';
    if (!clientCrn) {
      return NextResponse.json({ error: 'Client CRN is required' }, { status: 400 });
    }
    const clientRows = await query<{ crn: string }>(
      `SELECT crn FROM clients WHERE crn = ?`,
      [clientCrn]
    );
    if (clientRows.length === 0) {
      return NextResponse.json({ error: 'Unknown client CRN' }, { status: 400 });
    }

    // Validate linkedFromId (if provided): must be a number and point to an engagement in the same team
    let linkedFromId: number | null = null;
    if (body.linkedFromId != null) {
      const n = Number(body.linkedFromId);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'Invalid linkedFromId' }, { status: 400 });
      }
      // Parent must be visible to the creator: their own team, or unassigned.
      const { clause: parentTeamClause, params: parentTeamParams } =
        teamScopeClause(teamConstraint(auth.payload));
      const parent = await query<{ id: number }>(
        `SELECT id FROM engagements WHERE id = ? ${parentTeamClause}`,
        [n, ...parentTeamParams]
      );
      if (parent.length === 0) {
        return NextResponse.json({ error: 'Linked engagement not found' }, { status: 400 });
      }
      linkedFromId = n;
    }

    const insertRows = await queryWrite<{ id: number }>(
      `INSERT INTO engagements (
        client_crn, internal_client_name, internal_client_dept,
        intake_type, ad_hoc_channel, type, team_members, department,
        date_started, date_finished, status, portfolio_logged, portfolio,
        nna, notes, tickers_mentioned, team, created_by_id, created_by_name,
        linked_from_id, project_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`,
      [
        clientCrn,
        body.internalClient?.name ?? null,
        body.internalClient?.clientDept ?? null,
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
        normalizeProjectId(body.projectId),
      ]
    );
    const id = Number(insertRows[0].id);

    const rows = await query<Record<string, unknown>>(
      `SELECT e.*, c.name AS client_name, c.crn_pending AS client_crn_pending FROM engagements e ${CLIENT_JOIN} WHERE e.id = ?`,
      [id]
    );

    emitEngagementChange('created');
    // Register any newly-typed internal client in the managed registry so it
    // shows up in Settings → Internal Clients (best-effort; never blocks the write).
    if (body.internalClient?.name) {
      void ensureInternalClient(
        body.internalClient.name,
        department,
        { id: auth.payload.sub, name: `${auth.payload.firstName} ${auth.payload.lastName}` }
      ).catch(err => console.error('ensureInternalClient (create) failed:', err));
    }
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
