export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import {
  computeMetrics,
  computeDepartmentBreakdown,
  computeContributionData,
  computeEngagementsList,
  STATIC_FILTER_OPTIONS,
  getDepartmentNames,
  getIntakeTypeNames,
  getProjectTypeNames,
} from '@/app/lib/db/aggregations';
import { getMockFilterOptions } from '@/app/lib/api/mock-computations';
import { hasDb } from '@/app/lib/db';
import { requireAuth, teamConstraint } from '@/app/lib/auth/require-auth';
import type { EngagementFilters } from '@/app/lib/api/client-interactions';

// POST /api/client-interactions/dashboard
// Body: EngagementFilters (camelCase)
// Returns all dashboard data in a single parallel request for fast initial page load.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    const filters: EngagementFilters = await req.json();

    const [metrics, departments, contributionData, engagements, deptNames, intakeNames, projectNames] = await Promise.all([
      computeMetrics(filters, sc),
      computeDepartmentBreakdown(filters, sc),
      computeContributionData(filters, sc),
      computeEngagementsList(filters, sc),
      hasDb() ? getDepartmentNames() : Promise.resolve<string[] | null>(null),
      hasDb() ? getIntakeTypeNames() : Promise.resolve<string[] | null>(null),
      hasDb() ? getProjectTypeNames() : Promise.resolve<string[] | null>(null),
    ]);

    return NextResponse.json({
      metrics,
      departments,
      contributionData,
      engagements,
      filterOptions: hasDb()
        ? {
            ...STATIC_FILTER_OPTIONS,
            departments: deptNames ?? STATIC_FILTER_OPTIONS.departments,
            intakeTypes: intakeNames ?? STATIC_FILTER_OPTIONS.intakeTypes,
            projectTypes: projectNames ?? STATIC_FILTER_OPTIONS.projectTypes,
          }
        : getMockFilterOptions(),
    });
  } catch (err) {
    console.error('POST /api/client-interactions/dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
}
