export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  kpiConstraint,
  canAccessKpiScope,
  isValidKpiScope,
  type KpiScope,
} from '@/app/lib/auth/require-auth';
import { toDisplayName } from '@/app/lib/auth/types';
import { queryUsers, getFounderId } from '@/app/lib/db/users';
import { computeReport, type ReportSubject } from '@/app/lib/db/kpi-report';
import { logActivity } from '@/app/lib/activity/log';
import type { KpiFilters, KpiReportSubject } from '@/app/lib/api/kpi';

const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

// POST /api/kpi/report
// Body: { scope, period, subject: { kind: 'team' } | { kind: 'person', displayName } }
// Returns the data behind the Team KPIs "Generate PDF" report.
//
// Access:
// - Team report: the same scopes the dashboard allows (canAccessKpiScope).
// - Person report: yourself, always. Anyone else only if you are the founder
//   (earliest-created account). This is the one place individual-level KPI data is
//   served, so the check lives here on the server, not just in the UI.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const payload = auth.payload;

  let body: { scope?: unknown; period?: unknown; subject?: Partial<KpiReportSubject> & { displayName?: unknown } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const period = typeof body.period === 'string' && PERIODS.includes(body.period) ? body.period : null;
  if (!period) {
    return NextResponse.json({ error: 'Invalid period.' }, { status: 400 });
  }

  const subjectKind = body.subject?.kind;
  let subject: ReportSubject;
  let filters: KpiFilters;

  if (subjectKind === 'team') {
    const scope = body.scope;
    // 'me' is a person, not a team; personal reports go through subject.kind 'person'.
    if (!isValidKpiScope(scope) || scope === 'me') {
      return NextResponse.json({ error: 'Invalid scope.' }, { status: 400 });
    }
    if (!canAccessKpiScope(payload, scope as KpiScope)) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }
    const team = scope === 'all' ? null : scope.slice('team:'.length);
    subject = team ? { kind: 'team', name: team, team } : { kind: 'all', name: 'All teams' };
    filters = { scope: scope as KpiScope, period };
  } else if (subjectKind === 'person') {
    const displayName = typeof body.subject?.displayName === 'string' ? body.subject.displayName.trim() : '';
    if (!displayName) {
      return NextResponse.json({ error: 'Invalid subject.' }, { status: 400 });
    }
    const isSelf = displayName === toDisplayName(payload.firstName, payload.lastName);
    if (!isSelf && (await getFounderId()) !== payload.sub) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }

    // Name, title and team for the report header. Your own report reads your user
    // row; anyone else's reads the roster (which also covers people without a login),
    // preferring the linked account's full name over the roster's abbreviated one.
    const rows = isSelf
      ? await queryUsers<Record<string, unknown>>(
          'SELECT first_name, last_name, title, team FROM users WHERE id = ?',
          [payload.sub]
        )
      : await queryUsers<Record<string, unknown>>(
          `SELECT COALESCE(u.first_name, tm.first_name) AS first_name,
                  COALESCE(u.last_name, tm.last_name)   AS last_name,
                  COALESCE(u.title, tm.title)           AS title,
                  tm.team
             FROM team_members tm
             LEFT JOIN users u ON u.id = tm.user_id
            WHERE tm.display_name = ?
            ORDER BY tm.status = 'active' DESC
            LIMIT 1`,
          [displayName]
        );
    const row = rows[0];
    if (!isSelf && !row) {
      return NextResponse.json({ error: 'Unknown team member.' }, { status: 404 });
    }
    subject = {
      kind: 'person',
      name: row ? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || displayName : displayName,
      title: row?.title ? String(row.title) : undefined,
      team: row?.team ? String(row.team) : undefined,
      member: displayName,
    };
    // A person's work is theirs across teams, so no team constraint applies.
    filters = { scope: 'all', period };
  } else {
    return NextResponse.json({ error: 'Invalid subject.' }, { status: 400 });
  }

  try {
    const constraints = subject.kind === 'person' ? {} : kpiConstraint(filters.scope, payload);
    const report = await computeReport(filters, constraints, subject);

    void logActivity(req, {
      action: 'kpi.report',
      entityType: 'kpi',
      details: { subject: subject.kind === 'person' ? subject.member : subject.name, kind: subject.kind, period },
    });

    return NextResponse.json(report);
  } catch (err) {
    console.error('POST /api/kpi/report error:', err);
    return NextResponse.json({ error: 'Failed to build report.' }, { status: 500 });
  }
}
