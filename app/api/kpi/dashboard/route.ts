export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withRequestMemo } from '@/app/lib/db/requestMemo';
import {
  requireAuth,
  kpiConstraint,
  canAccessKpiScope,
  isValidKpiScope,
  type KpiScope,
} from '@/app/lib/auth/require-auth';
import {
  computeHeroKpis,
  computeJourneySankey,
  computeJourneyTemplates,
  computeClientDeptBreakdown,
  computeNnaConcentration,
  computeTickerNna,
  computeStaleEngagements,
  computeDormantClients,
  computeWeeklyFlow,
  computeMixDrift,
  computeCycleTimes,
  computeChainRolled,
  computeSegmentMatrix,
  computeChaseList,
  computeSpawnRate,
  computeClientBase,
} from '@/app/lib/db/kpi-aggregations';
import { resolveStaleThreshold, type KpiFilters } from '@/app/lib/api/kpi';

// POST /api/kpi/dashboard
// Body: { scope, period, clientDepts, intakeTypes, projectTypes }
// Returns team-level / cross-team KPI aggregates, or the caller's own ('me').
// Never another individual's data.
// Registry lookups shared by the aggregations below run once per request.
export function POST(req: NextRequest) {
  return withRequestMemo(() => handlePost(req));
}

async function handlePost(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;

  let body: Partial<KpiFilters>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const scope = body.scope;
  if (!isValidKpiScope(scope)) {
    return NextResponse.json({ error: 'Invalid scope.' }, { status: 400 });
  }
  if (!canAccessKpiScope(auth.payload, scope as KpiScope)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const filters: KpiFilters = {
    scope: scope as KpiScope,
    period: body.period || 'YTD',
    clientDepts: Array.isArray(body.clientDepts) ? body.clientDepts : [],
    intakeTypes: Array.isArray(body.intakeTypes) ? body.intakeTypes : [],
    projectTypes: Array.isArray(body.projectTypes)
      ? body.projectTypes.filter((t): t is string => typeof t === 'string')
      : [],
    staleThreshold: resolveStaleThreshold(body.staleThreshold),
  };

  const constraints = kpiConstraint(filters.scope, auth.payload);
  const types = filters.projectTypes ?? [];

  try {
    const [
      heroKpis,
      journeySankey,
      journeyTemplates,
      clientDepts,
      nnaConcentration,
      tickerNna,
      staleEngagements,
      dormantClients,
      // Extended "Briefing" metrics — scope + project type only, fixed intrinsic windows.
      weeklyFlow,
      mixDrift,
      cycleTimes,
      chainRolled,
      segmentMatrix,
      chaseList,
      spawnRate,
      clientBaseResult,
    ] = await Promise.all([
      computeHeroKpis(filters, constraints),
      computeJourneySankey(filters, constraints),
      computeJourneyTemplates(filters, constraints),
      computeClientDeptBreakdown(filters, constraints),
      computeNnaConcentration(filters, constraints),
      computeTickerNna(filters, constraints),
      computeStaleEngagements(filters, constraints),
      computeDormantClients(filters, constraints),
      computeWeeklyFlow(constraints, types),
      computeMixDrift(constraints, types),
      computeCycleTimes(constraints, types),
      computeChainRolled(constraints, types),
      computeSegmentMatrix(constraints, types),
      computeChaseList(constraints, types),
      computeSpawnRate(constraints, types),
      computeClientBase(constraints, types),
    ]);

    return NextResponse.json({
      scope: filters.scope === 'all' || filters.scope === 'me'
        ? { kind: filters.scope }
        : { kind: 'team', team: filters.scope.slice('team:'.length) },
      periodLabel: heroKpis.periodLabel,
      heroKpis,
      journeySankey,
      journeyTemplates,
      clientDepts,
      nnaConcentration,
      tickerNna,
      staleEngagements,
      dormantClients,
      extended: {
        weeklyFlow,
        mixDrift,
        cycleTimes,
        chainRolled,
        segmentMatrix,
        chaseList,
        spawnRate,
        clientBase: clientBaseResult.clientBase,
        uniquePerDept: clientBaseResult.uniquePerDept,
      },
    });
  } catch (err) {
    console.error('POST /api/kpi/dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load KPI dashboard data.' }, { status: 500 });
  }
}
