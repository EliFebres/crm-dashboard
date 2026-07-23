/**
 * Client wrapper for the Portfolio Trends read route.
 *
 * Types come from app/lib/types/portfolioTrends.ts, never from app/lib/db — importing the
 * db module here would pull better-sqlite3 into the browser bundle.
 */
import type {
  PortfolioTrendsFilters,
  PortfolioTrendsResponse,
} from '@/app/lib/types/portfolioTrends';

export async function getPortfolioTrends(
  filters: PortfolioTrendsFilters = {}
): Promise<PortfolioTrendsResponse> {
  const response = await fetch('/api/client-interactions/portfolio-trends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters),
  });
  if (!response.ok) throw new Error('Failed to fetch portfolio trends');
  return response.json();
}
