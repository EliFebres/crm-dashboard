// Data and functions for Client Engagements Dashboard
// Used for mock data (when SQLITE_DIR is not set) and by scripts/seed-db.ts


import type { Engagement, DayData, GCGAdHocChannel, PortfolioHolding, AssetClass } from '../types/engagements';

// Sample tickers for portfolio generation
const sampleTickers = [
  'FMAC', 'FMAS', 'FMAT', 'FMAX', 'FMCF', 'FMEM', 'FMEV', 'FMIC', 'FMIP', 'FMIS',
  'FMIV', 'FMLV', 'FMND', 'FMNM', 'FMSD', 'FMSV', 'FMUV', 'FMVX', 'FISV', 'FSTX',
  'VTI', 'VOO', 'VEA', 'VWO', 'BND', 'BNDX', 'VNQ', 'VIG', 'VXUS', 'VGT',
  'AGG', 'LQD', 'HYG', 'TIP', 'MUB', 'SHY', 'IEF', 'TLT', 'EMB', 'VCIT',
];

const assetClasses: AssetClass[] = ['Equity', 'Fixed Income', 'Alternatives'];

// Generate a random portfolio with 3-8 holdings
function generatePortfolio(seed: number): PortfolioHolding[] {
  const numHoldings = 3 + Math.floor(seededRandom(seed) * 6); // 3-8 holdings
  const holdings: PortfolioHolding[] = [];
  const usedTickers = new Set<string>();

  // Generate random weights that will be normalized
  const rawWeights: number[] = [];
  for (let i = 0; i < numHoldings; i++) {
    rawWeights.push(5 + seededRandom(seed + i + 100) * 30); // 5-35 raw weight
  }
  const totalWeight = rawWeights.reduce((a, b) => a + b, 0);

  for (let i = 0; i < numHoldings; i++) {
    let ticker: string;
    let attempts = 0;
    do {
      ticker = sampleTickers[Math.floor(seededRandom(seed + i * 7 + attempts) * sampleTickers.length)];
      attempts++;
    } while (usedTickers.has(ticker) && attempts < 100);
    usedTickers.add(ticker);

    // Determine asset class based on ticker prefix
    let assetClass: AssetClass;
    if (ticker.startsWith('FM') || ticker.startsWith('FI') || ticker.startsWith('FS') || ['VTI', 'VOO', 'VEA', 'VWO', 'VIG', 'VXUS', 'VGT', 'VNQ'].includes(ticker)) {
      assetClass = 'Equity';
    } else if (['AGG', 'LQD', 'HYG', 'TIP', 'MUB', 'SHY', 'IEF', 'TLT', 'EMB', 'VCIT', 'BND', 'BNDX'].includes(ticker)) {
      assetClass = 'Fixed Income';
    } else {
      assetClass = assetClasses[Math.floor(seededRandom(seed + i * 11) * assetClasses.length)];
    }

    holdings.push({
      identifier: ticker,
      constituentType: 'Security',
      assetClass,
      weight: rawWeights[i] / totalWeight, // Normalized weight
    });
  }

  return holdings;
}

// GCG Ad-Hoc interaction channels
const adHocChannels: GCGAdHocChannel[] = ['In-Person', 'Email', 'Teams'];

// Sample tickers mentioned in GCG Ad-Hoc conversations (mix of firm funds, competitors, and popular ETFs)
const conversationTickers = [
  // Firm funds
  'FMAC', 'FMAS', 'FMAT', 'FMAX', 'FMCF', 'FMEM', 'FMEV', 'FMIC', 'FMIV', 'FMLV', 'FMUV', 'FMSV',
  // Popular competitor ETFs
  'VOO', 'VTI', 'SPY', 'IVV', 'QQQ', 'VEA', 'VWO', 'IEMG', 'EFA', 'AGG', 'BND', 'LQD',
  // Large cap stocks often discussed
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'JPM', 'V', 'JNJ', 'UNH',
  // Other popular ETFs
  'SCHD', 'VIG', 'JEPI', 'VYM', 'XLK', 'XLF', 'XLE', 'IWM', 'RSP', 'ARKK',
];

// Generate random tickers mentioned (1-5 tickers)
function generateTickersMentioned(seed: number): string[] {
  const numTickers = 1 + Math.floor(seededRandom(seed) * 5); // 1-5 tickers
  const tickers: string[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < numTickers; i++) {
    let idx: number;
    let attempts = 0;
    do {
      idx = Math.floor(seededRandom(seed + i * 7 + attempts) * conversationTickers.length);
      attempts++;
    } while (usedIndices.has(idx) && attempts < 50);
    usedIndices.add(idx);
    tickers.push(conversationTickers[idx]);
  }

  return tickers;
}

// Sample notes for dummy data
const sampleNotes = [
  'Client requested additional breakdowns by sector. Follow up scheduled for next week.',
  'Discussed portfolio rebalancing strategy. Client prefers conservative approach with 60/40 allocation.',
  'Meeting went well. Client interested in firm funds for tax-loss harvesting opportunities.',
  'Need to send updated performance report. Client comparing against Vanguard benchmark.',
  'Client has concerns about interest rate sensitivity. Recommended shorter duration bonds.',
  'Follow-up call to discuss model changes. Client approved new allocation.',
  'Reviewed quarterly performance. Client satisfied with results relative to benchmark.',
  'Client requested information on ESG integration options. Will prepare materials.',
  'Discussed fee structure and provided comparison to competitors.',
  'Client considering consolidating accounts. Need to prepare transition plan.',
  'Technical issue with data export resolved. Client received updated files.',
  'Annual review completed. No changes to IPS at this time.',
  'Client inquired about alternative investments. Explained limitations within current mandate.',
  'Prepared custom report for board presentation. Client very appreciative.',
  'Addressed compliance questions regarding trading restrictions.',
];

// Internal client (relationship owner/salesperson) roster mapped to GCG departments
const internalClients = {
  // IAG Team
  'Jennifer Martinez': { name: 'Jennifer Martinez', gcgDepartment: 'IAG' as const },
  'Robert Chen': { name: 'Robert Chen', gcgDepartment: 'IAG' as const },
  'Amanda Foster': { name: 'Amanda Foster', gcgDepartment: 'IAG' as const },
  // Broker-Dealer Team
  'Michael Thompson': { name: 'Michael Thompson', gcgDepartment: 'Broker-Dealer' as const },
  'Jessica Williams': { name: 'Jessica Williams', gcgDepartment: 'Broker-Dealer' as const },
  'Daniel Park': { name: 'Daniel Park', gcgDepartment: 'Broker-Dealer' as const },
  // Institutional Team
  'Christopher Lee': { name: 'Christopher Lee', gcgDepartment: 'Institutional' as const },
  'Rachel Goldman': { name: 'Rachel Goldman', gcgDepartment: 'Institutional' as const },
  'Andrew Mitchell': { name: 'Andrew Mitchell', gcgDepartment: 'Institutional' as const },
  // Retirement Group Team
  'Patricia Evans': { name: 'Patricia Evans', gcgDepartment: 'Retirement Group' as const },
  'Steven Nguyen': { name: 'Steven Nguyen', gcgDepartment: 'Retirement Group' as const },
};

// External client companies for dummy data
const externalClients = [
  'Vanguard Advisors', 'Fidelity Wealth Management', 'Schwab Private Client', 'Northern Trust Wealth',
  'Raymond James Financial', 'Morgan Stanley Private', 'Merrill Lynch Advisors', 'Goldman Sachs PWM',
  'Wells Fargo Advisors', 'Ameriprise Financial', 'LPL Financial', 'Northwestern Mutual',
  'Stifel Financial', 'RBC Wealth Management', 'Baird Private Wealth', 'Oppenheimer Holdings',
  'Piper Sandler', 'Cetera Financial Group', 'Cambridge Investment', 'Osaic Wealth',
  'Truist Advisory Services', 'Edward Jones', 'Janney Montgomery Scott', 'Kestra Financial',
  'First Republic', 'BMO Private Bank', 'PNC Wealth', 'US Bank Wealth', 'Huntington Private',
  'KeyBank Wealth', 'Fifth Third Advisors', 'Regions Wealth', 'Citizens Private', 'TD Wealth',
  'CIBC Private', 'Raymond James Tax Credit', 'Sanctuary Wealth', 'Hightower Advisors',
  'Focus Financial', 'Creative Planning', 'Mariner Wealth', 'Captrust Financial',
];

// Team members with office assignments (5 Charlotte, 7 Austin)
export const teamMemberOffices: Record<string, 'Charlotte' | 'Austin'> = {
  'Eli F.': 'Charlotte',
  'Sarah K.': 'Charlotte',
  'Mike R.': 'Charlotte',
  'Lisa M.': 'Charlotte',
  'James T.': 'Charlotte',
  'David L.': 'Austin',
  'Rachel W.': 'Austin',
  'Chris B.': 'Austin',
  'Amanda P.': 'Austin',
  'Kevin H.': 'Austin',
  'Nicole S.': 'Austin',
  'Brandon T.': 'Austin',
};

const teamMembers = Object.keys(teamMemberOffices);
const internalClientKeys = Object.keys(internalClients) as (keyof typeof internalClients)[];
const projectTypes = ['Meeting', 'Discovery Meeting', 'Data Request', 'PCR', 'Follow-up Material', 'Follow-up Meeting'];
const adHocProjectTypes = ['PCR', 'Discovery Meeting', 'Data Request', 'Other']; // Project types specific to GCG Ad-Hoc

// Seeded random for consistent data generation
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

// Weighted department selection: IAG 50%, Broker-Dealer 30%, Institutional 11%, Retirement Group 9%
function getWeightedDepartment(seed: number): 'IAG' | 'Broker-Dealer' | 'Institutional' | 'Retirement Group' {
  const rand = seededRandom(seed);
  if (rand < 0.50) return 'IAG';
  if (rand < 0.80) return 'Broker-Dealer'; // 0.50 + 0.30 = 0.80
  if (rand < 0.91) return 'Institutional'; // 0.80 + 0.11 = 0.91
  return 'Retirement Group';
}

// Get internal client from a specific department
function getInternalClientByDepartment(dept: 'IAG' | 'Broker-Dealer' | 'Institutional' | 'Retirement Group', seed: number): typeof internalClients[keyof typeof internalClients] {
  const clientsByDept = internalClientKeys.filter(key => internalClients[key].gcgDepartment === dept);
  const selectedKey = clientsByDept[Math.floor(seededRandom(seed) * clientsByDept.length)];
  return internalClients[selectedKey];
}

// Generate NNA (Net New Assets) value based on department
// IAG: averages ~$20M, Broker-Dealer/Institutional: usually ~$100M, rare $1B (whales)
function generateNNA(dept: 'IAG' | 'Broker-Dealer' | 'Institutional' | 'Retirement Group', seed: number): number {
  const rand = seededRandom(seed);

  if (dept === 'IAG') {
    // IAG: $5M to $50M range, averaging around $20M
    const base = 5_000_000;
    const variance = rand * 45_000_000; // 0-45M variance
    return Math.round((base + variance) / 100_000) * 100_000; // Round to nearest 100k
  } else {
    // Broker-Dealer and Institutional: usually ~$100M, rare $1B whales
    const isWhale = seededRandom(seed + 100) < 0.05; // 5% chance of whale
    if (isWhale) {
      // Whale: $500M to $1.5B
      const base = 500_000_000;
      const variance = rand * 1_000_000_000;
      return Math.round((base + variance) / 10_000_000) * 10_000_000; // Round to nearest 10M
    } else {
      // Normal: $50M to $200M range, averaging around $100M
      const base = 50_000_000;
      const variance = rand * 150_000_000;
      return Math.round((base + variance) / 1_000_000) * 1_000_000; // Round to nearest 1M
    }
  }
}

// Generate 2 years of engagement data
function generateEngagements(): Engagement[] {
  const engagements: Engagement[] = [];
  let id = 1;

  // Start from Feb 1, 2023 to Jan 31, 2025 (2 years)
  const startDate = new Date('2023-02-01');
  const endDate = new Date('2025-01-31');

  // Cutoff date - anything finishing after this shows as blank/in-progress
  const cutoffDate = new Date('2025-01-28');

  // Holiday/slow weeks (week numbers where activity is reduced)
  const slowWeeks = [
    51, 52, // Christmas/New Year (late Dec)
    26, // July 4th week
    47, // Thanksgiving week
  ];

  const currentDate = new Date(startDate);
  let weekNum = 0;

  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();

    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      currentDate.setDate(currentDate.getDate() + 1);
      continue;
    }

    // Track week number for slow weeks
    if (dayOfWeek === 1) weekNum++;

    // Determine activity level for this week
    const isSlowWeek = slowWeeks.includes(weekNum % 52);
    const weekSeed = weekNum * 100;

    // GCG Ad-Hoc: 2-3 per day normally, 0-1 during slow weeks
    const baseAdHoc = isSlowWeek ? 0.5 : 2.5;
    const adHocVariance = seededRandom(weekSeed + currentDate.getDate()) - 0.5;
    const adHocToday = Math.max(0, Math.round(baseAdHoc + adHocVariance));

    // Projects: ~4 per week = ~0.8 per day, less during slow weeks
    const baseProjects = isSlowWeek ? 0.2 : 0.8;
    const projectVariance = (seededRandom(weekSeed + currentDate.getDate() + 50) - 0.5) * 0.6;
    const projectsToday = Math.max(0, Math.round(baseProjects + projectVariance));

    const dateStr = currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Generate GCG Ad-Hoc interactions for today
    for (let i = 0; i < adHocToday; i++) {
      const seed = id * 17;
      const dept = getWeightedDepartment(seed);
      const internalClient = getInternalClientByDepartment(dept, seed + 1);
      const teamCount = 1 + Math.floor(seededRandom(seed + 2) * 2);
      const selectedTeam: string[] = [];
      for (let t = 0; t < teamCount; t++) {
        const member = teamMembers[Math.floor(seededRandom(seed + 3 + t) * teamMembers.length)];
        if (!selectedTeam.includes(member)) selectedTeam.push(member);
      }

      // Touch points complete same day or next day
      const finishOffset = Math.floor(seededRandom(seed + 10) * 2);
      const finishDate = new Date(currentDate);
      finishDate.setDate(finishDate.getDate() + finishOffset);

      // Check if finish date is after cutoff
      const isAfterCutoff = finishDate > cutoffDate;
      const finishStr = isAfterCutoff ? '—' : finishDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      // Randomly select project type for GCG Ad-Hoc
      const adHocType = adHocProjectTypes[Math.floor(seededRandom(seed + 7) * adHocProjectTypes.length)];

      // PCR/Other usually doesn't have an external client (only 15% do), Data Request usually does (70%)
      const hasExternalClient = (adHocType === 'PCR' || adHocType === 'Other')
        ? seededRandom(seed + 1) > 0.85
        : seededRandom(seed + 1) > 0.3;

      // Randomly assign a channel for the ad-hoc interaction
      const adHocChannel = adHocChannels[Math.floor(seededRandom(seed + 11) * adHocChannels.length)];

      // NNA: Extremely rare for GCG Ad-Hoc (~0.001% chance), only if completed
      const hasNNA = !isAfterCutoff && seededRandom(seed + 12) < 0.00001;
      const nnaValue = hasNNA ? generateNNA(dept, seed + 13) : undefined;

      // Tickers mentioned: ~45% of GCG Ad-Hoc interactions discuss specific tickers
      const hasTickersMentioned = seededRandom(seed + 15) < 0.45;
      const tickersMentioned = hasTickersMentioned ? generateTickersMentioned(seed + 16) : undefined;

      engagements.push({
        id: id++,
        externalClient: hasExternalClient ? externalClients[Math.floor(seededRandom(seed + 4) * externalClients.length)] : null,
        internalClient,
        intakeType: 'GCG Ad-Hoc',
        adHocChannel,
        type: adHocType,
        teamMembers: selectedTeam,
        department: internalClient.gcgDepartment,
        dateStarted: dateStr,
        dateFinished: finishStr,
        status: isAfterCutoff ? 'In Progress' : 'Completed',
        portfolioLogged: false, // GCG Ad-Hoc don't have logged portfolios
        nna: nnaValue,
        notes: seededRandom(seed + 6) > 0.6 ? sampleNotes[Math.floor(seededRandom(seed + 14) * sampleNotes.length)] : undefined,
        tickersMentioned,
      });
    }

    // Generate projects for today
    for (let i = 0; i < projectsToday; i++) {
      const seed = id * 23;
      const dept = getWeightedDepartment(seed);
      const internalClient = getInternalClientByDepartment(dept, seed + 1);
      const intakeType: 'IRQ' | 'SERF' = seededRandom(seed + 2) > 0.5 ? 'IRQ' : 'SERF';
      const projectType = projectTypes[Math.floor(seededRandom(seed + 3) * projectTypes.length)];
      const teamCount = 1 + Math.floor(seededRandom(seed + 4) * 3);
      const selectedTeam: string[] = [];
      for (let t = 0; t < teamCount; t++) {
        const member = teamMembers[Math.floor(seededRandom(seed + 5 + t) * teamMembers.length)];
        if (!selectedTeam.includes(member)) selectedTeam.push(member);
      }

      // Projects take 2-5 days
      const duration = 2 + Math.floor(seededRandom(seed + 10) * 4);
      const finishDate = new Date(currentDate);
      finishDate.setDate(finishDate.getDate() + duration);

      // Check if finish date is after cutoff
      const isAfterCutoff = finishDate > cutoffDate;
      const finishStr = isAfterCutoff ? '—' : finishDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      // NNA: ~10% of completed client projects result in NNA
      const hasNNA = !isAfterCutoff && seededRandom(seed + 11) < 0.10;
      const nnaValue = hasNNA ? generateNNA(dept, seed + 12) : undefined;

      // Determine if portfolio is logged (PCRs don't have logged portfolios, in-progress items don't either)
      const hasPortfolio = isAfterCutoff || projectType === 'PCR' ? false : seededRandom(seed + 7) > 0.15;
      const portfolio = hasPortfolio ? generatePortfolio(seed + 20) : undefined;

      engagements.push({
        id: id++,
        externalClient: externalClients[Math.floor(seededRandom(seed + 6) * externalClients.length)],
        internalClient,
        intakeType,
        type: projectType,
        teamMembers: selectedTeam,
        department: dept,
        dateStarted: dateStr,
        dateFinished: finishStr,
        status: isAfterCutoff ? 'In Progress' : 'Completed',
        portfolioLogged: hasPortfolio,
        portfolio,
        nna: nnaValue,
        notes: seededRandom(seed + 8) > 0.5 ? sampleNotes[Math.floor(seededRandom(seed + 13) * sampleNotes.length)] : undefined,
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Add a few in-progress and pending items for recent dates
  const recentDate = new Date('2025-01-27');
  for (let i = 0; i < 5; i++) {
    const seed = (id + i) * 31;
    const dept = getWeightedDepartment(seed);
    const internalClient = getInternalClientByDepartment(dept, seed + 1);
    const intakeType: 'IRQ' | 'SERF' = seededRandom(seed + 2) > 0.5 ? 'IRQ' : 'SERF';
    const status = i < 3 ? 'In Progress' : 'Pending';
    const teamCount = 1 + Math.floor(seededRandom(seed + 4) * 3);
    const selectedTeam: string[] = [];
    for (let t = 0; t < teamCount; t++) {
      const member = teamMembers[Math.floor(seededRandom(seed + 5 + t) * teamMembers.length)];
      if (!selectedTeam.includes(member)) selectedTeam.push(member);
    }

    const startOffset = Math.floor(seededRandom(seed + 10) * 5);
    const startDate = new Date(recentDate);
    startDate.setDate(startDate.getDate() - startOffset);

    engagements.push({
      id: id++,
      externalClient: externalClients[Math.floor(seededRandom(seed + 6) * externalClients.length)],
      internalClient,
      intakeType,
      type: projectTypes[Math.floor(seededRandom(seed + 3) * projectTypes.length)],
      teamMembers: selectedTeam,
      department: dept,
      dateStarted: startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      dateFinished: '—',
      status,
      portfolioLogged: false,
      nna: undefined, // In-progress items don't have NNA yet
      notes: seededRandom(seed + 8) > 0.5 ? sampleNotes[Math.floor(seededRandom(seed + 13) * sampleNotes.length)] : undefined,
    });
  }

  return engagements;
}

export const engagements: Engagement[] = generateEngagements();

// Parse date string like "Jan 20, 2025" to Date object
function parseDateString(dateStr: string): Date | null {
  if (dateStr === '—') return null;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Get date string in YYYY-MM-DD format for comparison
function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Generate contribution graph data from engagements
// Can optionally pass filtered engagements to show filtered heatmap
export function generateContributionData(filteredEngagements?: Engagement[]): DayData[][] {
  const weeks: DayData[][] = [];
  const startDate = new Date('2023-02-01'); // Start 2 years before most recent data
  const dataSource = filteredEngagements ?? engagements;

  // Build a map of completed engagements by date
  const completionsByDate: Record<string, { projects: number; adHoc: number }> = {};

  for (const engagement of dataSource) {
    const finishedDate = parseDateString(engagement.dateFinished);
    if (finishedDate) {
      const key = getDateKey(finishedDate);
      if (!completionsByDate[key]) {
        completionsByDate[key] = { projects: 0, adHoc: 0 };
      }
      if (engagement.intakeType === 'GCG Ad-Hoc') {
        completionsByDate[key].adHoc++;
      } else {
        completionsByDate[key].projects++;
      }
    }
  }

  // Generate 105 weeks of data (2 years + 1 week to always include the current week)
  for (let week = 0; week < 105; week++) {
    const days: DayData[] = [];
    for (let day = 0; day < 5; day++) {
      const currentDate = new Date(startDate);
      // Adjust for weekday positioning (Mon=0, Tue=1, etc.)
      const weekStart = new Date(startDate);
      weekStart.setDate(startDate.getDate() + week * 7);
      // Find the Monday of this week
      const dayOfWeek = weekStart.getDay();
      const mondayOffset = dayOfWeek === 0 ? 1 : (dayOfWeek === 6 ? 2 : 1 - dayOfWeek);
      currentDate.setDate(startDate.getDate() + week * 7 + mondayOffset + day);

      const key = getDateKey(currentDate);
      const completions = completionsByDate[key] || { projects: 0, adHoc: 0 };
      const totalCount = completions.projects + completions.adHoc;

      // Determine activity level based on count
      let level: number;
      if (totalCount === 0) level = 0;
      else if (totalCount === 1) level = 1;
      else if (totalCount === 2) level = 2;
      else if (totalCount <= 4) level = 3;
      else level = 4;

      days.push({
        date: currentDate,
        level,
        count: totalCount,
        projectCount: completions.projects,
        adHocCount: completions.adHoc,
      });
    }
    weeks.push(days);
  }
  return weeks;
}
