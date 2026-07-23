/**
 * Shared Portfolio Trends contract.
 *
 * Kept free of any database import so the client bundle can use these types and the
 * AVG_CLIENT constant without pulling in better-sqlite3.
 */

/** The synthetic cohort: each client collapsed to its single main model. */
export const AVG_CLIENT = 'Avg. Client';

export interface PortfolioTrendsFilters {
  departments?: string[];
  offices?: string[];
  teams?: string[];
  /** Model names, and/or AVG_CLIENT to mean "each client's main model". */
  cohorts?: string[];
  /** Strict lower bound in dollars. Models with a NULL aum never match. */
  minAum?: number | null;
}

export interface PortfolioTrendsSummary {
  modelsLogged: number;
  uniqueClients: number;
  equityModels: number;
  fixedIncomeModels: number;
  avgPositions: number;
  recentUpdatesPct: number;
  /** Models excluded from any AUM threshold because their AUM was never entered. */
  modelsWithoutAum: number;
}

export interface PortfolioCohort {
  name: string;
  modelCount: number;
}

export interface PortfolioTrendsFilterOptions {
  departments: string[];
  offices: string[];
  teams: string[];
  cohorts: PortfolioCohort[];
}

export interface PortfolioTrendsResponse {
  summary: PortfolioTrendsSummary;
  filterOptions: PortfolioTrendsFilterOptions;
  /**
   * Market data for the style / profitability / fixed-income cards. Always null today:
   * deriving market cap, price-to-book, profitability, duration, credit quality, yields
   * or maturity from a ticker needs a security master this app does not have. Those cards
   * render an explicit "requires market data" state while this is null, rather than
   * showing invented numbers.
   */
  marketData: null;
}
