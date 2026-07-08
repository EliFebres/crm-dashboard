export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
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
// Body: { scope, period, clientDepts, intakeTypes }
// Returns team-level / cross-team KPI aggregates. No individual-level data.
export async function POST(req: NextRequest) {
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
    period: body.period || '1Y',
    clientDepts: Array.isArray(body.clientDepts) ? body.clientDepts : [],
    intakeTypes: Array.isArray(body.intakeTypes) ? body.intakeTypes : [],
    staleThreshold: resolveStaleThreshold(body.staleThreshold),
  };

  const constraints = kpiConstraint(filters.scope);

  try {
    const [
      heroKpis,
      journeySankey,
      journeyTemplates,
      clientDepts,
      nnaConcentration,
      staleEngagements,
      dormantClients,
      // Extended "Briefing" metrics — scope(team)-only, fixed intrinsic windows.
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
      computeStaleEngagements(filters, constraints),
      computeDormantClients(filters, constraints),
      computeWeeklyFlow(constraints),
      computeMixDrift(constraints),
      computeCycleTimes(constraints),
      computeChainRolled(constraints),
      computeSegmentMatrix(constraints),
      computeChaseList(constraints),
      computeSpawnRate(constraints),
      computeClientBase(constraints),
    ]);

    return NextResponse.json({
      scope: filters.scope === 'all'
        ? { kind: 'all' }
        : { kind: 'team', team: filters.scope.slice('team:'.length) },
      periodLabel: heroKpis.periodLabel,
      heroKpis,
      journeySankey,
      journeyTemplates,
      clientDepts,
      nnaConcentration,
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
