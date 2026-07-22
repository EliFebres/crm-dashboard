// Data and functions for Client Engagements Dashboard
// Used for mock data (when SQLITE_DIR is not set) and by scripts/seed-db.ts


import type { Engagement, Client, DayData, AdHocChannel, PortfolioHolding, AssetClass } from '../types/engagements';
import { getContributionWindow } from '../db/dateUtils';

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

// Ad-Hoc interaction channels
const adHocChannels: AdHocChannel[] = ['In-Person', 'Email', 'Teams'];

// Sample tickers mentioned in Ad-Hoc conversations (mix of firm funds, competitors, and popular ETFs)
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

// Internal client (relationship owner/salesperson) roster mapped to client departments
const internalClients = {
  // Advisory Team
  'Avery Bennett': { name: 'Avery Bennett', clientDept: 'Advisory' as const },
  'Cameron Brooks': { name: 'Cameron Brooks', clientDept: 'Advisory' as const },
  'Dakota Carter': { name: 'Dakota Carter', clientDept: 'Advisory' as const },
  // Brokerage Team
  'Emerson Diaz': { name: 'Emerson Diaz', clientDept: 'Brokerage' as const },
  'Sawyer Grant': { name: 'Sawyer Grant', clientDept: 'Brokerage' as const },
  'Hayden Cole': { name: 'Hayden Cole', clientDept: 'Brokerage' as const },
  // Institutional Team
  'Jordan Ellis': { name: 'Jordan Ellis', clientDept: 'Institutional' as const },
  'Kendall Frost': { name: 'Kendall Frost', clientDept: 'Institutional' as const },
  'Logan Hale': { name: 'Logan Hale', clientDept: 'Institutional' as const },
  // Retirement Team
  'Marlowe Reed': { name: 'Marlowe Reed', clientDept: 'Retirement' as const },
  'Nico Sutton': { name: 'Nico Sutton', clientDept: 'Retirement' as const },
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

// Pick a mock external client (name + a deterministic synthetic CRN). Same name
// always maps to the same CRN, mirroring the real registry where one client = one CRN.
function mockClient(seed: number): { name: string; crn: string } {
  const idx = Math.floor(seededRandom(seed) * externalClients.length);
  return { name: externalClients[idx], crn: `MOCK-${String(idx + 1).padStart(6, '0')}` };
}

// Team members with office assignments (5 Office A, 7 Office B)
export const teamMemberOffices: Record<string, 'Office A' | 'Office B'> = {
  'Alex M.': 'Office A',
  'Blake N.': 'Office A',
  'Casey P.': 'Office A',
  'Dana R.': 'Office A',
  'Evan S.': 'Office A',
  'Finley T.': 'Office B',
  'Gray W.': 'Office B',
  'Harper B.': 'Office B',
  'Indi C.': 'Office B',
  'Jules D.': 'Office B',
  'Kai E.': 'Office B',
  'Lane F.': 'Office B',
};

const teamMembers = Object.keys(teamMemberOffices);
const internalClientKeys = Object.keys(internalClients) as (keyof typeof internalClients)[];
const projectTypes = ['Meeting', 'Discovery Meeting', 'Data Request', 'Data Update', 'PCR', 'Follow-up Material', 'Follow-up Meeting'];
const adHocProjectTypes = ['PCR', 'Discovery Meeting', 'Data Request', 'Data Update', 'Other']; // Project types specific to Ad-Hoc

// Seeded random for consistent data generation
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

// Weighted department selection: Advisory 50%, Brokerage 30%, Institutional 11%, Retirement 9%
function getWeightedDepartment(seed: number): 'Advisory' | 'Brokerage' | 'Institutional' | 'Retirement' {
  const rand = seededRandom(seed);
  if (rand < 0.50) return 'Advisory';
  if (rand < 0.80) return 'Brokerage'; // 0.50 + 0.30 = 0.80
  if (rand < 0.91) return 'Institutional'; // 0.80 + 0.11 = 0.91
  return 'Retirement';
}

// Get internal client from a specific department
function getInternalClientByDepartment(dept: 'Advisory' | 'Brokerage' | 'Institutional' | 'Retirement', seed: number): typeof internalClients[keyof typeof internalClients] {
  const clientsByDept = internalClientKeys.filter(key => internalClients[key].clientDept === dept);
  const selectedKey = clientsByDept[Math.floor(seededRandom(seed) * clientsByDept.length)];
  return internalClients[selectedKey];
}

// Generate NNA (Net New Assets) value based on department
// Advisory: averages ~$20M, Brokerage/Institutional: usually ~$100M, rare $1B (whales)
function generateNNA(dept: 'Advisory' | 'Brokerage' | 'Institutional' | 'Retirement', seed: number): number {
  const rand = seededRandom(seed);

  if (dept === 'Advisory') {
    // Advisory: $5M to $50M range, averaging around $20M
    const base = 5_000_000;
    const variance = rand * 45_000_000; // 0-45M variance
    return Math.round((base + variance) / 100_000) * 100_000; // Round to nearest 100k
  } else {
    // Brokerage and Institutional: usually ~$100M, rare $1B whales
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

  // Anchor the 2-year window so it ends "today". Engagement CONTENT is driven by
  // seeded RNG on id/weekNum (date-independent), so only the absolute dates move —
  // re-seeds stay deterministic within a given day while guaranteeing the
  // dashboard's default (last-12-months) view is always populated.
  const endDate = new Date();
  endDate.setHours(0, 0, 0, 0);
  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - 2);

  // Cutoff date - anything finishing after this shows as blank/in-progress.
  // Held 3 days before the end so the most recent items read as in-progress.
  const cutoffDate = new Date(endDate);
  cutoffDate.setDate(cutoffDate.getDate() - 3);

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

    // Ad-Hoc: 2-3 per day normally, 0-1 during slow weeks
    const baseAdHoc = isSlowWeek ? 0.5 : 2.5;
    const adHocVariance = seededRandom(weekSeed + currentDate.getDate()) - 0.5;
    const adHocToday = Math.max(0, Math.round(baseAdHoc + adHocVariance));

    // Projects: ~4 per week = ~0.8 per day, less during slow weeks
    const baseProjects = isSlowWeek ? 0.2 : 0.8;
    const projectVariance = (seededRandom(weekSeed + currentDate.getDate() + 50) - 0.5) * 0.6;
    const projectsToday = Math.max(0, Math.round(baseProjects + projectVariance));

    const dateStr = currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Generate Ad-Hoc interactions for today
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

      // Randomly select project type for Ad-Hoc
      const adHocType = adHocProjectTypes[Math.floor(seededRandom(seed + 7) * adHocProjectTypes.length)];

      // Randomly assign a channel for the ad-hoc interaction
      const adHocChannel = adHocChannels[Math.floor(seededRandom(seed + 11) * adHocChannels.length)];

      // NNA: Extremely rare for Ad-Hoc (~0.001% chance), only if completed
      const hasNNA = !isAfterCutoff && seededRandom(seed + 12) < 0.00001;
      const nnaValue = hasNNA ? generateNNA(dept, seed + 13) : undefined;

      // Tickers mentioned: ~45% of Ad-Hoc interactions discuss specific tickers
      const hasTickersMentioned = seededRandom(seed + 15) < 0.45;
      const tickersMentioned = hasTickersMentioned ? generateTickersMentioned(seed + 16) : undefined;

      const adHocClient = mockClient(seed + 4);
      engagements.push({
        id: id++,
        clientCrn: adHocClient.crn,
        externalClient: adHocClient.name,
        internalClient,
        intakeType: 'Ad-Hoc',
        adHocChannel,
        type: adHocType,
        teamMembers: selectedTeam,
        department: internalClient.clientDept,
        dateStarted: dateStr,
        dateFinished: finishStr,
        status: isAfterCutoff ? 'In Progress' : 'Completed',
        portfolioLogged: false, // Ad-Hoc don't have logged portfolios
        portfolioUnchanged: false,
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

      const projectClient = mockClient(seed + 6);
      // ~15% of tracked projects have no Project ID assigned yet.
      const projectId = seededRandom(seed + 21) < 0.15 ? undefined : `PRJ-${String(1000 + id).padStart(4, '0')}`;
      engagements.push({
        id: id++,
        clientCrn: projectClient.crn,
        externalClient: projectClient.name,
        internalClient,
        intakeType,
        type: projectType,
        projectId,
        teamMembers: selectedTeam,
        department: dept,
        dateStarted: dateStr,
        dateFinished: finishStr,
        status: isAfterCutoff ? 'In Progress' : 'Completed',
        portfolioLogged: hasPortfolio,
        portfolioUnchanged: false,
        portfolio,
        nna: nnaValue,
        notes: seededRandom(seed + 8) > 0.5 ? sampleNotes[Math.floor(seededRandom(seed + 13) * sampleNotes.length)] : undefined,
      });
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Add a few in-progress and pending items for recent dates
  const recentDate = new Date(endDate);
  recentDate.setDate(recentDate.getDate() - 4);
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

    const recentClient = mockClient(seed + 6);
    const projectId = `PRJ-${String(1000 + id).padStart(4, '0')}`;
    engagements.push({
      id: id++,
      clientCrn: recentClient.crn,
      externalClient: recentClient.name,
      internalClient,
      intakeType,
      type: projectTypes[Math.floor(seededRandom(seed + 3) * projectTypes.length)],
      projectId,
      teamMembers: selectedTeam,
      department: dept,
      dateStarted: startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      dateFinished: '—',
      status,
      portfolioLogged: false,
      portfolioUnchanged: false,
      nna: undefined, // In-progress items don't have NNA yet
      notes: seededRandom(seed + 8) > 0.5 ? sampleNotes[Math.floor(seededRandom(seed + 13) * sampleNotes.length)] : undefined,
    });
  }

  return engagements;
}

export const engagements: Engagement[] = generateEngagements();

// Derived client registry for the dev-without-db (mock) fallback: one entry per
// distinct CRN that appears on the mock engagements.
export const clients: Client[] = (() => {
  const byCrn = new Map<string, Client>();
  for (const e of engagements) {
    if (e.clientCrn && !byCrn.has(e.clientCrn)) {
      byCrn.set(e.clientCrn, { crn: e.clientCrn, name: e.externalClient });
    }
  }
  return Array.from(byCrn.values()).sort((a, b) => a.name.localeCompare(b.name));
})();

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
// Can optionally pass filtered engagements to show a filtered heatmap, and a
// period so the window tracks the active filter (matching the DB path).
export function generateContributionData(filteredEngagements?: Engagement[], period: string = '1Y'): DayData[][] {
  const dataSource = filteredEngagements ?? engagements;

  // Build a map of completed engagements by date, tracking the earliest one.
  const completionsByDate: Record<string, { projects: number; adHoc: number }> = {};
  let earliestISO: string | null = null;

  for (const engagement of dataSource) {
    const finishedDate = parseDateString(engagement.dateFinished);
    if (finishedDate) {
      const key = getDateKey(finishedDate);
      if (!completionsByDate[key]) {
        completionsByDate[key] = { projects: 0, adHoc: 0 };
      }
      if (engagement.intakeType === 'Ad-Hoc') {
        completionsByDate[key].adHoc++;
      } else {
        completionsByDate[key].projects++;
      }
      if (!earliestISO || key < earliestISO) earliestISO = key;
    }
  }

  // Window spans the active period (full history for ALL) up to today.
  const { anchorMonday, weekCount } = getContributionWindow(period, earliestISO);

  const weeks: DayData[][] = [];
  for (let week = 0; week < weekCount; week++) {
    const days: DayData[] = [];
    for (let day = 0; day < 5; day++) {
      const currentDate = new Date(anchorMonday);
      currentDate.setDate(anchorMonday.getDate() + week * 7 + day);

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
