// Types for Trends Dashboard

export interface PortfolioMetric {
  label: string;
  value: string;
  change: string;
  isPositive: boolean;
  benchmark: string | null;
}

export interface BenchmarkComparison {
  metric: string;
  client: number;
  acwi: number;
  delta: number;
}

export interface TickerRequestBreakdown {
  pcrRequests: number;
  pcrDownloads: number;
  tickersMentioned: number;
  clientModels: number;
}

export interface QuarterlyRequests {
  quarter: string;   // e.g. "Q4 2024"
  requests: number;
}

export interface HotTicker {
  rank: number;
  type: string;
  ticker: string;
  name: string;
  requests: number;
  trend: string;
  firmCompetitor: string;
  firmName: string;
  returnComparison: {
    competitor: number;
    firm: number;
    delta: string;
  };
  expenseRatio: {
    competitor: number;
    firm: number;
  };
  aum: {
    competitor: string;
    firm: string;
  };
  flows: {
    competitor: string;
    firm: string;
  };
  notes: string;
  talkingPointsUrl: string;
  pcrUrl: string;
  requestBreakdown?: TickerRequestBreakdown;
  quarterlyRequests?: QuarterlyRequests[];
}

export interface PopularFirmTicker {
  rank: number;
  ticker: string;
  name: string;
  holdings: number;
  pctModels: string;
  trend: string;
}

export interface TickerTrend {
  month: string;
  FMUS: number;
  FMAI: number;
  FMAE: number;
}

// Portfolio Logged Data Types
export interface PortfolioPosition {
  ticker: string;
  name: string;
  weight: number; // Percentage as decimal (0.15 = 15%)
}

export interface PortfolioCharacteristics {
  // Equity characteristics
  weightedAvgMarketCap: number; // in billions
  weightedAvgPB: number; // price-to-book ratio
  weightedAvgProfitability: number; // as decimal
  valueAllocation: number; // percentage
  growthAllocation: number; // percentage
  // Regional allocations (can be 0)
  usEquityAllocation: number; // percentage
  devExUsAllocation: number; // developed ex-US percentage
  emAllocation: number; // emerging markets percentage
  // Fixed income characteristics (can be 0)
  duration: number; // years
  avgCreditQuality: string; // e.g., "AA", "A", "BBB"
  avgYield: number; // percentage
}

export interface PortfolioReturns {
  oneYear: number | null; // percentage, null if not enough history
  threeYear: number | null;
  fiveYear: number | null;
  tenYear: number | null;
  fifteenYear: number | null;
  twentyYear: number | null;
}

export interface InternalClientInfo {
  name: string;
  clientDept: 'Advisory' | 'Brokerage' | 'Institutional';
}

export interface LoggedPortfolio {
  id: number;
  externalClient: string; // Required - cannot be empty
  internalClient: InternalClientInfo; // Required - cannot be empty
  loggedBy: string; // Team member who logged it
  loggedAt: string; // When it was logged (date string)
  dataAsOf: string; // Usually end of month prior to logging
  positions: PortfolioPosition[];
  characteristics: PortfolioCharacteristics;
  returns: PortfolioReturns;
}

// Computed/Aggregated types for deriving trends from portfolio data

export interface TickerCount {
  ticker: string;
  name: string;
  count: number; // Number of portfolios containing this ticker
  totalWeight: number; // Sum of weights across all portfolios
  avgWeight: number; // Average weight when included
  isFirm: boolean;
}

export interface FirmAlternative {
  competitorTicker: string;
  firmTicker: string;
  firmName: string;
  matchType: 'overlap' | 'benchmark' | 'manual';
  overlapScore?: number;
}

export interface ComputedHotTicker {
  rank: number;
  ticker: string;
  name: string;
  count: number; // Number of mentions/holdings
  trend: string;
  firmAlternative: FirmAlternative | null;
}

export interface ComputedPopularFirmTicker {
  rank: number;
  ticker: string;
  name: string;
  count: number; // Number of portfolios holding this ticker
  pctOfTotal: number; // Percentage of total portfolios
  avgWeight: number;
  trend: string;
}

export interface ComputedTickerTrend {
  month: string;
  [ticker: string]: string | number; // Dynamic ticker keys with counts
}

export interface FilterOptions {
  teamMembers: string[];
  departments: string[];
  periods: string[];
}

export interface TrendsFilterState {
  teamMember: string;
  department: string;
  period: string;
}
