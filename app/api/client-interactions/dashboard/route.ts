export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withRequestMemo } from '@/app/lib/db/requestMemo';
import {
  computeMetrics,
  computeDepartmentBreakdown,
  computeContributionData,
  computeEngagementsList,
  STATIC_FILTER_OPTIONS,
  getDepartmentNames,
  getIntakeTypeNames,
  getProjectTypeNames,
  getOfficeNames,
} from '@/app/lib/db/aggregations';
import { intakeColorMap } from '@/app/lib/db/intakeTypes';
import { projectTypeColorMap } from '@/app/lib/db/projectTypes';
import { getMockFilterOptions } from '@/app/lib/api/mock-computations';
import { hasDb } from '@/app/lib/db';
import { requireAuth, teamConstraint } from '@/app/lib/auth/require-auth';
import type { EngagementFilters } from '@/app/lib/api/client-interactions';

// POST /api/client-interactions/dashboard
// Body: EngagementFilters (camelCase)
// Returns all dashboard data in a single parallel request for fast initial page load.
// Registry lookups shared by the aggregations below run once per request.
export function POST(req: NextRequest) {
  return withRequestMemo(() => handlePost(req));
}

async function handlePost(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    const filters: EngagementFilters = await req.json();

    const [metrics, departments, contributionData, engagements, deptNames, intakeNames, projectNames, officeNames, intakeColors, projectColors] = await Promise.all([
      computeMetrics(filters, sc),
      computeDepartmentBreakdown(filters, sc),
      computeContributionData(filters, sc),
      computeEngagementsList(filters, sc),
      hasDb() ? getDepartmentNames() : Promise.resolve<string[] | null>(null),
      hasDb() ? getIntakeTypeNames() : Promise.resolve<string[] | null>(null),
      hasDb() ? getProjectTypeNames() : Promise.resolve<string[] | null>(null),
      hasDb() ? getOfficeNames() : Promise.resolve<string[] | null>(null),
      hasDb() ? intakeColorMap() : Promise.resolve(null),
      hasDb() ? projectTypeColorMap() : Promise.resolve(null),
    ]);

    return NextResponse.json({
      metrics,
      departments,
      contributionData,
      engagements,
      filterOptions: hasDb()
        ? {
            ...STATIC_FILTER_OPTIONS,
            // Team Member filter reflects the actual managed Offices (admin order).
            teamMembers: ['All Team Members', ...(officeNames ?? [])],
            teamMemberGroups: officeNames && officeNames.length > 0
              ? [{ label: 'Office', options: officeNames }]
              : [],
            departments: deptNames ?? STATIC_FILTER_OPTIONS.departments,
            intakeTypes: intakeNames ?? STATIC_FILTER_OPTIONS.intakeTypes,
            projectTypes: projectNames ?? STATIC_FILTER_OPTIONS.projectTypes,
          }
        : getMockFilterOptions(),
      // Badge colors for the table, so it doesn't fetch the type registries itself.
      typeColors: intakeColors && projectColors
        ? { intake: intakeColors, project: projectColors }
        : null,
    });
  } catch (err) {
    console.error('POST /api/client-interactions/dashboard error:', err);
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
}
