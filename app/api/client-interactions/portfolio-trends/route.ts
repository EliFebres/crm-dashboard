export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { computePortfolioTrends } from '@/app/lib/db/portfolioTrends';
import { requireAuth, teamConstraint } from '@/app/lib/auth/require-auth';
import type { PortfolioTrendsFilters } from '@/app/lib/types/portfolioTrends';

// POST /api/client-interactions/portfolio-trends
// Body: PortfolioTrendsFilters (departments, offices, teams, cohorts, minAum)
//
// Reads portfolio.sqlite, which is a projection of client_models refreshed by
// `npm run sync:portfolio` — so this reflects the last sync, not live edits.
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const sc = teamConstraint(auth.payload);

  try {
    const filters: PortfolioTrendsFilters = await req.json();
    const trends = await computePortfolioTrends(filters, sc);
    return NextResponse.json(trends);
  } catch (err) {
    console.error('POST /api/client-interactions/portfolio-trends error:', err);
    return NextResponse.json({ error: 'Failed to compute portfolio trends' }, { status: 500 });
  }
}
