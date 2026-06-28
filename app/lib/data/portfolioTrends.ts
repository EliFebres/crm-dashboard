// Data and functions for Portfolio Trends Dashboard

import type {
  PortfolioMetric,
  BenchmarkComparison,
  LoggedPortfolio,
  FilterOptions,
} from '../types/trends';

// ==================== PORTFOLIO DATA ====================

export const loggedPortfolios: LoggedPortfolio[] = [
  {
    id: 1,
    externalClient: 'Vanguard Advisors',
    internalClient: { name: 'Jennifer Martinez', clientDept: 'Advisory' },
    loggedBy: 'Eli F.',
    loggedAt: 'Jan 15, 2026',
    dataAsOf: 'Dec 31, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.35 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.20 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.05 },
      { ticker: 'FMSV', name: 'Firm US Small Cap Value', weight: 0.10 },
      { ticker: 'FMIV', name: 'Firm Intl Small Cap Value', weight: 0.05 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.15 },
      { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', weight: 0.10 },
    ],
    characteristics: {
      weightedAvgMarketCap: 285.4,
      weightedAvgPB: 2.8,
      weightedAvgProfitability: 0.42,
      valueAllocation: 48,
      growthAllocation: 52,
      usEquityAllocation: 55,
      devExUsAllocation: 25,
      emAllocation: 5,
      duration: 4.2,
      avgCreditQuality: 'AA',
      avgYield: 4.5,
    },
    returns: {
      oneYear: 18.4,
      threeYear: 8.2,
      fiveYear: 10.1,
      tenYear: 9.8,
      fifteenYear: null,
      twentyYear: null,
    },
  },
  {
    id: 2,
    externalClient: 'Fidelity Wealth Management',
    internalClient: { name: 'Michael Thompson', clientDept: 'Brokerage' },
    loggedBy: 'Sarah K.',
    loggedAt: 'Jan 12, 2026',
    dataAsOf: 'Dec 31, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.40 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.25 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.10 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.20 },
      { ticker: 'FMLV', name: 'Firm US Large Cap Value', weight: 0.05 },
    ],
    characteristics: {
      weightedAvgMarketCap: 320.1,
      weightedAvgPB: 3.1,
      weightedAvgProfitability: 0.45,
      valueAllocation: 42,
      growthAllocation: 58,
      usEquityAllocation: 45,
      devExUsAllocation: 25,
      emAllocation: 10,
      duration: 5.1,
      avgCreditQuality: 'A+',
      avgYield: 4.8,
    },
    returns: {
      oneYear: 16.8,
      threeYear: 7.5,
      fiveYear: 9.2,
      tenYear: 8.9,
      fifteenYear: 8.1,
      twentyYear: null,
    },
  },
  {
    id: 3,
    externalClient: 'Northern Trust Wealth',
    internalClient: { name: 'Christopher Lee', clientDept: 'Institutional' },
    loggedBy: 'Mike R.',
    loggedAt: 'Jan 10, 2026',
    dataAsOf: 'Dec 31, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.30 },
      { ticker: 'FMAC', name: 'Firm US Core Equity 2', weight: 0.15 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.15 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.08 },
      { ticker: 'FMSV', name: 'Firm US Small Cap Value', weight: 0.12 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.20 },
    ],
    characteristics: {
      weightedAvgMarketCap: 195.8,
      weightedAvgPB: 2.4,
      weightedAvgProfitability: 0.38,
      valueAllocation: 55,
      growthAllocation: 45,
      usEquityAllocation: 57,
      devExUsAllocation: 15,
      emAllocation: 8,
      duration: 5.5,
      avgCreditQuality: 'AA-',
      avgYield: 4.6,
    },
    returns: {
      oneYear: 19.2,
      threeYear: 9.1,
      fiveYear: 10.8,
      tenYear: 10.2,
      fifteenYear: 9.4,
      twentyYear: 8.8,
    },
  },
  {
    id: 4,
    externalClient: 'Raymond James Financial',
    internalClient: { name: 'Amanda Foster', clientDept: 'Advisory' },
    loggedBy: 'Lisa M.',
    loggedAt: 'Jan 8, 2026',
    dataAsOf: 'Dec 31, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.45 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.20 },
      { ticker: 'FMSV', name: 'Firm US Small Cap Value', weight: 0.15 },
      { ticker: 'VTI', name: 'Vanguard Total Stock Market', weight: 0.10 },
      { ticker: 'BND', name: 'Vanguard Total Bond Market', weight: 0.10 },
    ],
    characteristics: {
      weightedAvgMarketCap: 310.5,
      weightedAvgPB: 3.0,
      weightedAvgProfitability: 0.44,
      valueAllocation: 46,
      growthAllocation: 54,
      usEquityAllocation: 70,
      devExUsAllocation: 20,
      emAllocation: 0,
      duration: 3.8,
      avgCreditQuality: 'A',
      avgYield: 4.2,
    },
    returns: {
      oneYear: 20.1,
      threeYear: 8.8,
      fiveYear: 10.5,
      tenYear: null,
      fifteenYear: null,
      twentyYear: null,
    },
  },
  {
    id: 5,
    externalClient: 'Morgan Stanley Private',
    internalClient: { name: 'Jessica Williams', clientDept: 'Brokerage' },
    loggedBy: 'James T.',
    loggedAt: 'Jan 5, 2026',
    dataAsOf: 'Dec 31, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.25 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.15 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.05 },
      { ticker: 'FMIV', name: 'Firm Intl Small Cap Value', weight: 0.10 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.30 },
      { ticker: 'FMSD', name: 'Firm Short Duration Fixed Income', weight: 0.15 },
    ],
    characteristics: {
      weightedAvgMarketCap: 245.2,
      weightedAvgPB: 2.6,
      weightedAvgProfitability: 0.40,
      valueAllocation: 50,
      growthAllocation: 50,
      usEquityAllocation: 25,
      devExUsAllocation: 25,
      emAllocation: 5,
      duration: 4.8,
      avgCreditQuality: 'AA+',
      avgYield: 5.1,
    },
    returns: {
      oneYear: 12.4,
      threeYear: 6.2,
      fiveYear: 7.8,
      tenYear: 7.5,
      fifteenYear: 7.2,
      twentyYear: null,
    },
  },
  {
    id: 6,
    externalClient: 'Goldman Sachs PWM',
    internalClient: { name: 'Rachel Goldman', clientDept: 'Institutional' },
    loggedBy: 'David L.',
    loggedAt: 'Jan 3, 2026',
    dataAsOf: 'Dec 31, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.35 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.25 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.15 },
      { ticker: 'FMSV', name: 'Firm US Small Cap Value', weight: 0.08 },
      { ticker: 'FISV', name: 'Firm Intl Small Cap Value', weight: 0.07 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.10 },
    ],
    characteristics: {
      weightedAvgMarketCap: 180.3,
      weightedAvgPB: 2.2,
      weightedAvgProfitability: 0.36,
      valueAllocation: 58,
      growthAllocation: 42,
      usEquityAllocation: 43,
      devExUsAllocation: 32,
      emAllocation: 15,
      duration: 4.0,
      avgCreditQuality: 'A+',
      avgYield: 4.4,
    },
    returns: {
      oneYear: 17.6,
      threeYear: 8.9,
      fiveYear: 11.2,
      tenYear: 10.5,
      fifteenYear: 9.8,
      twentyYear: 9.2,
    },
  },
  {
    id: 7,
    externalClient: 'Wells Fargo Advisors',
    internalClient: { name: 'Robert Chen', clientDept: 'Advisory' },
    loggedBy: 'Eli F.',
    loggedAt: 'Dec 28, 2025',
    dataAsOf: 'Nov 30, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.50 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.20 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.25 },
      { ticker: 'IJR', name: 'iShares Core S&P Small-Cap', weight: 0.05 },
    ],
    characteristics: {
      weightedAvgMarketCap: 350.2,
      weightedAvgPB: 3.2,
      weightedAvgProfitability: 0.46,
      valueAllocation: 40,
      growthAllocation: 60,
      usEquityAllocation: 55,
      devExUsAllocation: 20,
      emAllocation: 0,
      duration: 5.8,
      avgCreditQuality: 'AA',
      avgYield: 4.9,
    },
    returns: {
      oneYear: 15.8,
      threeYear: 7.2,
      fiveYear: 8.9,
      tenYear: 8.5,
      fifteenYear: null,
      twentyYear: null,
    },
  },
  {
    id: 8,
    externalClient: 'Ameriprise Financial',
    internalClient: { name: 'Daniel Park', clientDept: 'Brokerage' },
    loggedBy: 'Sarah K.',
    loggedAt: 'Dec 20, 2025',
    dataAsOf: 'Nov 30, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.30 },
      { ticker: 'FMAC', name: 'Firm US Core Equity 2', weight: 0.10 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.18 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.07 },
      { ticker: 'FMSV', name: 'Firm US Small Cap Value', weight: 0.10 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.15 },
      { ticker: 'VOO', name: 'Vanguard S&P 500 ETF', weight: 0.10 },
    ],
    characteristics: {
      weightedAvgMarketCap: 275.8,
      weightedAvgPB: 2.7,
      weightedAvgProfitability: 0.41,
      valueAllocation: 47,
      growthAllocation: 53,
      usEquityAllocation: 50,
      devExUsAllocation: 18,
      emAllocation: 7,
      duration: 4.5,
      avgCreditQuality: 'A+',
      avgYield: 4.6,
    },
    returns: {
      oneYear: 17.2,
      threeYear: 7.8,
      fiveYear: 9.5,
      tenYear: 9.1,
      fifteenYear: 8.5,
      twentyYear: null,
    },
  },
  {
    id: 9,
    externalClient: 'LPL Financial',
    internalClient: { name: 'Andrew Mitchell', clientDept: 'Institutional' },
    loggedBy: 'Mike R.',
    loggedAt: 'Dec 15, 2025',
    dataAsOf: 'Nov 30, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.40 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.22 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.08 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.20 },
      { ticker: 'VXUS', name: 'Vanguard Total Intl Stock', weight: 0.10 },
    ],
    characteristics: {
      weightedAvgMarketCap: 298.5,
      weightedAvgPB: 2.9,
      weightedAvgProfitability: 0.43,
      valueAllocation: 44,
      growthAllocation: 56,
      usEquityAllocation: 40,
      devExUsAllocation: 32,
      emAllocation: 8,
      duration: 5.2,
      avgCreditQuality: 'AA-',
      avgYield: 4.7,
    },
    returns: {
      oneYear: 16.5,
      threeYear: 7.6,
      fiveYear: 9.3,
      tenYear: 8.8,
      fifteenYear: 8.2,
      twentyYear: 7.9,
    },
  },
  {
    id: 10,
    externalClient: 'Schwab Private Client',
    internalClient: { name: 'Jennifer Martinez', clientDept: 'Advisory' },
    loggedBy: 'Lisa M.',
    loggedAt: 'Dec 10, 2025',
    dataAsOf: 'Nov 30, 2025',
    positions: [
      { ticker: 'FMUS', name: 'Firm US Core Equity 1', weight: 0.35 },
      { ticker: 'FMAI', name: 'Firm Intl Core Equity', weight: 0.20 },
      { ticker: 'FMAE', name: 'Firm Emerging Core Equity', weight: 0.05 },
      { ticker: 'FMSV', name: 'Firm US Small Cap Value', weight: 0.12 },
      { ticker: 'FMIV', name: 'Firm Intl Small Cap Value', weight: 0.08 },
      { ticker: 'FMCF', name: 'Firm Core Fixed Income', weight: 0.20 },
    ],
    characteristics: {
      weightedAvgMarketCap: 220.4,
      weightedAvgPB: 2.5,
      weightedAvgProfitability: 0.39,
      valueAllocation: 52,
      growthAllocation: 48,
      usEquityAllocation: 47,
      devExUsAllocation: 28,
      emAllocation: 5,
      duration: 5.0,
      avgCreditQuality: 'A+',
      avgYield: 4.5,
    },
    returns: {
      oneYear: 18.8,
      threeYear: 8.5,
      fiveYear: 10.2,
      tenYear: 9.6,
      fifteenYear: 9.0,
      twentyYear: null,
    },
  },
];

// ==================== HELPER FUNCTIONS ====================

// Firm ticker prefixes for identification
const FIRM_PREFIXES = ['FM', 'FI', 'FS'];

export function isFirmTicker(ticker: string): boolean {
  return FIRM_PREFIXES.some(prefix => ticker.startsWith(prefix));
}

// Parse date string like "Jan 15, 2025" to Date object
function parseLoggedDate(dateStr: string): Date {
  return new Date(dateStr);
}

// Get the start date for a period filter
function getPeriodStartDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case '1M':
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case '3M':
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case '6M':
      return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case '1Y':
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case 'ALL':
    default:
      return null; // No date filter
  }
}

// ==================== FILTER FUNCTIONS ====================

export function extractFilterOptions(portfolios: LoggedPortfolio[], currentUser: string = 'Eli F.'): FilterOptions {
  const departmentsSet = new Set<string>();

  portfolios.forEach(portfolio => {
    departmentsSet.add(portfolio.internalClient.clientDept);
  });

  return {
    // Only show "All Team Members" and current user for privacy
    teamMembers: ['All Team Members', currentUser],
    departments: ['All Departments', ...Array.from(departmentsSet).sort()],
    periods: ['1M', '3M', '6M', '1Y', 'ALL'],
  };
}

export function filterPortfolios(
  portfolios: LoggedPortfolio[],
  teamMember: string,
  department: string,
  period: string
): LoggedPortfolio[] {
  let filtered = [...portfolios];

  // Filter by team member
  if (teamMember && teamMember !== 'All Team Members') {
    filtered = filtered.filter(p => p.loggedBy === teamMember);
  }

  // Filter by department
  if (department && department !== 'All Departments') {
    filtered = filtered.filter(p => p.internalClient.clientDept === department);
  }

  // Filter by period
  const periodStart = getPeriodStartDate(period);
  if (periodStart) {
    filtered = filtered.filter(p => {
      const loggedDate = parseLoggedDate(p.loggedAt);
      return loggedDate >= periodStart;
    });
  }

  return filtered;
}

// ==================== COMPUTED METRICS ====================

// Compute portfolio construction metrics from filtered portfolios
export function computePortfolioMetrics(portfolios: LoggedPortfolio[]): PortfolioMetric[] {
  if (portfolios.length === 0) {
    return [
      { label: 'Avg Line Items', value: '—', change: '—', isPositive: true, benchmark: null },
      { label: 'Avg Value Exposure', value: '—', change: '—', isPositive: true, benchmark: 'ACWI: 30%' },
      { label: 'Avg Growth Exposure', value: '—', change: '—', isPositive: true, benchmark: 'ACWI: 65%' },
      { label: 'Avg Firm Wallet Share', value: '—', change: '—', isPositive: true, benchmark: null },
    ];
  }

  // Calculate averages
  const avgLineItems = portfolios.reduce((sum, p) => sum + p.positions.length, 0) / portfolios.length;
  const avgValueExposure = portfolios.reduce((sum, p) => sum + p.characteristics.valueAllocation, 0) / portfolios.length;
  const avgGrowthExposure = portfolios.reduce((sum, p) => sum + p.characteristics.growthAllocation, 0) / portfolios.length;

  // Calculate firm wallet share (sum of firm ticker weights / total)
  let totalFirmWeight = 0;
  let totalWeight = 0;
  portfolios.forEach(p => {
    p.positions.forEach(pos => {
      totalWeight += pos.weight;
      if (isFirmTicker(pos.ticker)) {
        totalFirmWeight += pos.weight;
      }
    });
  });
  const avgFirmWalletShare = totalWeight > 0 ? (totalFirmWeight / totalWeight) * 100 : 0;

  return [
    { label: 'Avg Line Items', value: avgLineItems.toFixed(1), change: '+0.8', isPositive: true, benchmark: null },
    { label: 'Avg Value Exposure', value: `${Math.round(avgValueExposure)}%`, change: '+2%', isPositive: true, benchmark: 'ACWI: 30%' },
    { label: 'Avg Growth Exposure', value: `${Math.round(avgGrowthExposure)}%`, change: '+1%', isPositive: true, benchmark: 'ACWI: 65%' },
    { label: 'Avg Firm Wallet Share', value: `${Math.round(avgFirmWalletShare)}%`, change: '+4%', isPositive: true, benchmark: null },
  ];
}

// Compute fixed income metrics from filtered portfolios
export function computeFixedIncomeMetrics(portfolios: LoggedPortfolio[]): PortfolioMetric[] {
  // Filter to portfolios with fixed income (duration > 0)
  const fiPortfolios = portfolios.filter(p => p.characteristics.duration > 0);

  if (fiPortfolios.length === 0) {
    return [
      { label: 'Avg Duration', value: '—', change: '—', isPositive: true, benchmark: 'Agg: 6.1 yrs' },
      { label: 'Avg Credit Quality', value: '—', change: '—', isPositive: true, benchmark: 'Agg: AA-' },
      { label: 'Avg Yield', value: '—', change: '—', isPositive: true, benchmark: 'Agg: 4.5%' },
    ];
  }

  const avgDuration = fiPortfolios.reduce((sum, p) => sum + p.characteristics.duration, 0) / fiPortfolios.length;
  const avgYield = fiPortfolios.reduce((sum, p) => sum + p.characteristics.avgYield, 0) / fiPortfolios.length;

  // For credit quality, we'll use the most common one (simplified)
  const creditQualities = fiPortfolios.map(p => p.characteristics.avgCreditQuality);
  const qualityCount = new Map<string, number>();
  creditQualities.forEach(q => qualityCount.set(q, (qualityCount.get(q) || 0) + 1));
  let mostCommonQuality = 'A+';
  let maxCount = 0;
  qualityCount.forEach((count, quality) => {
    if (count > maxCount) {
      maxCount = count;
      mostCommonQuality = quality;
    }
  });

  return [
    { label: 'Avg Duration', value: `${avgDuration.toFixed(1)} yrs`, change: '-0.3', isPositive: true, benchmark: 'Agg: 6.1 yrs' },
    { label: 'Avg Credit Quality', value: mostCommonQuality, change: '—', isPositive: true, benchmark: 'Agg: AA-' },
    { label: 'Avg Yield', value: `${avgYield.toFixed(1)}%`, change: '+0.2%', isPositive: true, benchmark: 'Agg: 4.5%' },
  ];
}

// Compute benchmark comparison from filtered portfolios
export function computeBenchmarkComparison(portfolios: LoggedPortfolio[]): BenchmarkComparison[] {
  if (portfolios.length === 0) {
    return [
      { metric: 'US Equity', client: 0, acwi: 62, delta: -62 },
      { metric: 'Intl Dev', client: 0, acwi: 27, delta: -27 },
      { metric: 'EM', client: 0, acwi: 11, delta: -11 },
    ];
  }

  const avgUS = portfolios.reduce((sum, p) => sum + p.characteristics.usEquityAllocation, 0) / portfolios.length;
  const avgIntlDev = portfolios.reduce((sum, p) => sum + p.characteristics.devExUsAllocation, 0) / portfolios.length;
  const avgEM = portfolios.reduce((sum, p) => sum + p.characteristics.emAllocation, 0) / portfolios.length;

  return [
    { metric: 'US Equity', client: Math.round(avgUS), acwi: 62, delta: Math.round(avgUS) - 62 },
    { metric: 'Intl Dev', client: Math.round(avgIntlDev), acwi: 27, delta: Math.round(avgIntlDev) - 27 },
    { metric: 'EM', client: Math.round(avgEM), acwi: 11, delta: Math.round(avgEM) - 11 },
  ];
}
