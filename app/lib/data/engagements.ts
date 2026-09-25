// Data and functions for Client Engagements Dashboard
// Used for mock data (when SQLITE_DIR is not set) and by scripts/seed-db.ts
//
// The generator is deterministic for a given day: content is driven by a seeded
// RNG, and only the absolute dates move so the last two years always end "today".
// It deliberately exercises every feature the dashboard reads:
//   • established, brand-new, CRN-pending and not-yet-engaged external clients
//   • every intake type, every built-in project type plus one custom type
//   • all four statuses, including stale open work and old Follow Ups (chase list)
//   • NNA totals with per-ticker breakdowns (full and partial) and rich-text notes
//   • logged / carried-over model portfolios across every asset class
//   • three working teams, unassigned (team-less) inbox rows, inactive members
//   • deliberate Discovery → Follow-up → PCR funnels via linkedFromId


import type { Engagement, Client, DayData, AdHocChannel, PortfolioHolding, AssetClass, ConstituentType, NnaAllocation } from '../types/engagements';
import { getContributionWindow } from '../db/dateUtils';
import { normalizeNnaDetails } from '../nna';

/** A mock engagement plus the columns the seed script writes that the UI type omits. */
export type MockEngagement = Engagement & {
  /** Owning team (engagements.team); null = unassigned inbox, visible to everyone. */
  team: string | null;
  /** Display name ("First L.") of the member who logged it; null = the seed itself. */
  createdByDisplay: string | null;
};

type Dept = 'Advisory' | 'Brokerage' | 'Institutional' | 'Retirement';
type Status = 'In Progress' | 'Awaiting Meeting' | 'Follow Up' | 'Completed';

// Seeded random for consistent data generation
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

function pick<T>(list: readonly T[], seed: number): T {
  return list[Math.floor(seededRandom(seed) * list.length)];
}

// =============================================================================
// PORTFOLIOS
// =============================================================================

// Sample tickers for portfolio generation
const sampleTickers = [
  'FMAC', 'FMAS', 'FMAT', 'FMAX', 'FMCF', 'FMEM', 'FMEV', 'FMIC', 'FMIP', 'FMIS',
  'FMIV', 'FMLV', 'FMND', 'FMNM', 'FMSD', 'FMSV', 'FMUV', 'FMVX', 'FISV', 'FSTX',
  'VTI', 'VOO', 'VEA', 'VWO', 'BND', 'BNDX', 'VNQ', 'VIG', 'VXUS', 'VGT',
  'AGG', 'LQD', 'HYG', 'TIP', 'MUB', 'SHY', 'IEF', 'TLT', 'EMB', 'VCIT',
];

const assetClasses: AssetClass[] = ['Equity', 'Fixed Income', 'Alternatives'];

// Money-market, crypto, multi-asset, and fund-of-funds sleeves so seeded
// portfolios exercise every asset class — not just Equity/Fixed Income/Alternatives.
const CASH_TICKERS = ['VMFXX', 'SPAXX'];
const CRYPTO_TICKERS = ['IBIT', 'FBTC'];
const MULTI_TICKERS = ['AOR', 'AOA'];
const FOF_TICKERS = ['FOF'];
const newClassTickers = [...CASH_TICKERS, ...CRYPTO_TICKERS, ...MULTI_TICKERS, ...FOF_TICKERS];

// Generate a random portfolio with 3-8 holdings
function generatePortfolio(seed: number): PortfolioHolding[] {
  const numHoldings = 3 + Math.floor(seededRandom(seed) * 6); // 3-8 holdings
  const holdings: PortfolioHolding[] = [];
  const usedTickers = new Set<string>();

  // Blend a few newer-class tickers (Cash/Crypto/Multi-Asset/Fund of Funds) into
  // the selectable pool so logged portfolios surface those classes too.
  const tickerPool = [...sampleTickers, ...newClassTickers];

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
      ticker = tickerPool[Math.floor(seededRandom(seed + i * 7 + attempts) * tickerPool.length)];
      attempts++;
    } while (usedTickers.has(ticker) && attempts < 100);
    usedTickers.add(ticker);

    // Determine asset class based on ticker prefix / membership
    let assetClass: AssetClass;
    let constituentType: ConstituentType = 'Security';
    let identifier = ticker;
    if (CASH_TICKERS.includes(ticker)) {
      // Cash positions carry the dedicated Cash constituent type and a plain CASH ticker.
      assetClass = 'Cash';
      constituentType = 'Cash';
      identifier = 'CASH';
    } else if (CRYPTO_TICKERS.includes(ticker)) {
      assetClass = 'Crypto';
    } else if (MULTI_TICKERS.includes(ticker)) {
      assetClass = 'Multi-Asset';
    } else if (FOF_TICKERS.includes(ticker)) {
      assetClass = 'Fund of Funds';
    } else if (ticker.startsWith('FM') || ticker.startsWith('FI') || ticker.startsWith('FS') || ['VTI', 'VOO', 'VEA', 'VWO', 'VIG', 'VXUS', 'VGT', 'VNQ'].includes(ticker)) {
      assetClass = 'Equity';
    } else if (['AGG', 'LQD', 'HYG', 'TIP', 'MUB', 'SHY', 'IEF', 'TLT', 'EMB', 'VCIT', 'BND', 'BNDX'].includes(ticker)) {
      assetClass = 'Fixed Income';
    } else {
      assetClass = assetClasses[Math.floor(seededRandom(seed + i * 11) * assetClasses.length)];
    }

    holdings.push({
      identifier,
      constituentType,
      assetClass,
      weight: rawWeights[i] / totalWeight, // Normalized weight
    });
  }

  return holdings;
}

// =============================================================================
// AD-HOC CONVERSATIONS
// =============================================================================

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

// Pick `count` distinct entries from a pool
function pickDistinct(pool: readonly string[], seed: number, count: number): string[] {
  const out: string[] = [];
  let attempt = 0;
  while (out.length < count && attempt < 200) {
    const t = pool[Math.floor(seededRandom(seed + attempt * 7) * pool.length)];
    if (!out.includes(t)) out.push(t);
    attempt++;
  }
  return out;
}

// Generate random tickers mentioned (1-5 tickers)
function generateTickersMentioned(seed: number): string[] {
  return pickDistinct(conversationTickers, seed, 1 + Math.floor(seededRandom(seed) * 5));
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

// =============================================================================
// NNA (net new assets) — totals, per-ticker breakdowns and notes
// =============================================================================

// Generate NNA (Net New Assets) value based on department
// Advisory: averages ~$20M, Brokerage/Institutional: usually ~$100M, rare $1B (whales)
function generateNNA(dept: string, seed: number): number {
  const rand = seededRandom(seed);

  if (dept === 'Advisory') {
    // Advisory: $5M to $50M range, averaging around $20M
    const base = 5_000_000;
    const variance = rand * 45_000_000; // 0-45M variance
    return Math.round((base + variance) / 100_000) * 100_000; // Round to nearest 100k
  } else if (dept === 'Retirement') {
    // Retirement plans: $2M to $30M
    return Math.round((2_000_000 + rand * 28_000_000) / 100_000) * 100_000;
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

// Where NNA lands: mostly firm funds, with the occasional ETF sleeve.
const NNA_TICKERS = [
  'FMAC', 'FMAS', 'FMAT', 'FMAX', 'FMCF', 'FMEM', 'FMEV', 'FMIC', 'FMIP', 'FMIS',
  'FMIV', 'FMLV', 'FMSV', 'FMUV', 'FISV', 'FSTX', 'VOO', 'AGG', 'SCHD', 'BND',
];

/**
 * Split `target` dollars across `tickers`, rounded to `unit`, summing exactly to
 * the (rounded) target. Every slice gets at least one unit.
 */
function splitAmounts(target: number, tickers: string[], unit: number, seed: number): NnaAllocation[] {
  const units = Math.max(tickers.length, Math.floor(target / unit));
  const weights = tickers.map((_, i) => 1 + seededRandom(seed + i * 3) * 4);
  const totalW = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map(w => Math.max(1, Math.floor((w / totalW) * units)));
  // Give (or take) the rounding remainder to the largest slice.
  const drift = units - counts.reduce((a, b) => a + b, 0);
  const largest = counts.indexOf(Math.max(...counts));
  counts[largest] = Math.max(1, counts[largest] + drift);
  return tickers.map((ticker, i) => ({ ticker, amount: counts[i] * unit }));
}

const NNA_NOTE_TEMPLATES = [
  (t: string) => `<p>Assets moved over from a competitor ${t} sleeve after the model review.</p>`,
  (t: string) => `<p>Funded in two tranches; <strong>${t}</strong> took the first leg, remainder to follow next quarter.</p>`,
  (t: string) => `<ul><li>Replacement for legacy active manager</li><li>Primary position: ${t}</li><li>Rest parked in cash pending IC approval</li></ul>`,
  (t: string) => `<p>Advisor consolidated three household accounts; ${t} was the anchor holding.</p>`,
  (t: string) => `<p>Committee approved the switch at the quarterly meeting. Confirmed trade tickets for ${t}.</p>`,
];

/** Optional breakdown + notes for an NNA total, validated through the app's own rules. */
function generateNnaDetails(
  total: number,
  seed: number,
  forceTickers?: number
): { nnaAllocations?: NnaAllocation[]; nnaNotes?: string | null } {
  let allocations: NnaAllocation[] | undefined;
  if (forceTickers || seededRandom(seed) < 0.7) {
    const count = forceTickers ?? 1 + Math.floor(seededRandom(seed + 1) * 5);
    const tickers = pickDistinct(NNA_TICKERS, seed + 2, count);
    const unit = total >= 100_000_000 ? 1_000_000 : 100_000;
    // ~60% fully allocated; the rest leave 10-50% of the total unallocated.
    const full = forceTickers !== undefined || seededRandom(seed + 3) < 0.6;
    const share = full ? 1 : 0.5 + seededRandom(seed + 4) * 0.4;
    const target = Math.floor((total * share) / unit) * unit;
    if (target >= unit * tickers.length) allocations = splitAmounts(target, tickers, unit, seed + 5);
  }
  const notes = seededRandom(seed + 6) < 0.4
    ? pick(NNA_NOTE_TEMPLATES, seed + 7)(allocations?.[0]?.ticker ?? pick(NNA_TICKERS, seed + 8))
    : null;

  const result = normalizeNnaDetails({ nna: total, allocations: allocations ?? null, notes });
  if (!result.ok) throw new Error(`Mock NNA detail is invalid: ${result.error}`);
  return {
    nnaAllocations: result.value.allocations ?? undefined,
    nnaNotes: result.value.notes ?? null,
  };
}

// =============================================================================
// PEOPLE — relationship owners (internal clients) and our own team members
// =============================================================================

// Internal client (relationship owner/salesperson) roster mapped to client departments.
// Engaged continuously, so they always read as "returning" (Q13), never "dormant" (Q14).
const internalRoster: Array<{ name: string; clientDept: Dept }> = [
  { name: 'Avery Bennett', clientDept: 'Advisory' },
  { name: 'Cameron Brooks', clientDept: 'Advisory' },
  { name: 'Dakota Carter', clientDept: 'Advisory' },
  { name: 'Emerson Diaz', clientDept: 'Brokerage' },
  { name: 'Sawyer Grant', clientDept: 'Brokerage' },
  { name: 'Hayden Cole', clientDept: 'Brokerage' },
  { name: 'Jordan Ellis', clientDept: 'Institutional' },
  { name: 'Kendall Frost', clientDept: 'Institutional' },
  { name: 'Logan Hale', clientDept: 'Institutional' },
  { name: 'Marlowe Reed', clientDept: 'Retirement' },
  { name: 'Nico Sutton', clientDept: 'Retirement' },
];

// Team members: office, team, and when they were on the roster. Inactive members
// only appear on older work; Eli F. joined ~18 months ago.
interface MemberInfo { office: 'Office A' | 'Office B'; team: string; active: boolean; joinedDaysAgo?: number; leftDaysAgo?: number }
const MEMBERS: Record<string, MemberInfo> = {
  'Eli F.':    { office: 'Office A', team: 'Default Team', active: true, joinedDaysAgo: 540 },
  'Alex M.':   { office: 'Office A', team: 'Default Team', active: true },
  'Blake N.':  { office: 'Office A', team: 'Default Team', active: true },
  'Casey P.':  { office: 'Office A', team: 'Default Team', active: true },
  'Dana R.':   { office: 'Office A', team: 'Default Team', active: true },
  'Evan S.':   { office: 'Office A', team: 'Equity Specialist', active: true },
  'Finley T.': { office: 'Office B', team: 'Equity Specialist', active: true },
  'Gray W.':   { office: 'Office B', team: 'Equity Specialist', active: true },
  'Harper B.': { office: 'Office B', team: 'Equity Specialist', active: true },
  'Indi C.':   { office: 'Office B', team: 'Fixed Income Specialist', active: true },
  'Jules D.':  { office: 'Office B', team: 'Fixed Income Specialist', active: true },
  'Kai E.':    { office: 'Office B', team: 'Fixed Income Specialist', active: true },
  'Lane F.':   { office: 'Office B', team: 'Fixed Income Specialist', active: true },
  'Morgan K.': { office: 'Office B', team: 'Default Team', active: false, leftDaysAgo: 270 },
  'Sasha V.':  { office: 'Office A', team: 'Equity Specialist', active: false, leftDaysAgo: 300 },
};

// Team members with office assignments
export const teamMemberOffices: Record<string, 'Office A' | 'Office B'> = Object.fromEntries(
  Object.entries(MEMBERS).map(([name, m]) => [name, m.office])
);
/** Each team member's team. */
export const teamMemberTeams: Record<string, string> = Object.fromEntries(
  Object.entries(MEMBERS).map(([name, m]) => [name, m.team])
);
/** Members who have left — seeded with status 'inactive'. */
export const inactiveMembers: string[] = Object.entries(MEMBERS).filter(([, m]) => !m.active).map(([n]) => n);
/** The working teams engagements are spread across. */
export const MOCK_TEAMS = ['Default Team', 'Equity Specialist', 'Fixed Income Specialist'] as const;
/** Custom (admin-added) project type the mock data uses, beyond the built-ins. */
export const CUSTOM_PROJECT_TYPES = ['Due Diligence'];

function onRoster(name: string, daysAgo: number): boolean {
  const m = MEMBERS[name];
  if (m.joinedDaysAgo !== undefined && daysAgo > m.joinedDaysAgo) return false;
  if (m.leftDaysAgo !== undefined && daysAgo < m.leftDaysAgo) return false;
  return true;
}

/** Pick an owning team and 1..maxCount members (occasionally one borrowed from another team). */
function pickStaff(seed: number, daysAgo: number, maxCount: number): { team: string; members: string[] } {
  const r = seededRandom(seed);
  const team = r < 0.45 ? 'Default Team' : r < 0.75 ? 'Equity Specialist' : 'Fixed Income Specialist';
  const pool = Object.keys(MEMBERS).filter(n => MEMBERS[n].team === team && onRoster(n, daysAgo));
  const count = 1 + Math.floor(seededRandom(seed + 1) * maxCount);
  const members = pickDistinct(pool, seed + 2, Math.min(count, pool.length));
  if (seededRandom(seed + 3) < 0.12) {
    const others = Object.keys(MEMBERS).filter(n => MEMBERS[n].team !== team && onRoster(n, daysAgo));
    const guest = pick(others, seed + 4);
    if (!members.includes(guest)) members.push(guest);
  }
  return { team, members };
}

// =============================================================================
// EXTERNAL CLIENTS
// =============================================================================

interface MockClient { name: string; crn: string; crnPending?: boolean; firstDaysAgo?: number }

// Established relationships — engaged across the whole two-year window.
const ESTABLISHED = [
  'Vanguard Advisors', 'Fidelity Wealth Management', 'Schwab Private Client', 'Northern Trust Wealth',
  'Raymond James Financial', 'Morgan Stanley Private', 'Merrill Lynch Advisors', 'Goldman Sachs PWM',
  'Wells Fargo Advisors', 'Ameriprise Financial', 'LPL Financial', 'Northwestern Mutual',
  'Stifel Financial', 'RBC Wealth Management', 'Baird Private Wealth', 'Oppenheimer Holdings',
  'Piper Sandler', 'Cetera Financial Group', 'Cambridge Investment', 'Osaic Wealth',
  'Truist Advisory Services', 'Edward Jones', 'Janney Montgomery Scott', 'Kestra Financial',
  'First Republic', 'BMO Private Bank', 'PNC Wealth', 'US Bank Wealth', 'Huntington Private',
  'KeyBank Wealth', 'Fifth Third Advisors', 'Regions Wealth', 'Citizens Private', 'TD Wealth',
  'CIBC Private', 'Sanctuary Wealth', 'Hightower Advisors', 'Focus Financial', 'Creative Planning',
  'Mariner Wealth',
];
// Brand-new relationships — first engagement inside the last ~90 days.
const NEW_CLIENTS: Array<{ name: string; firstDaysAgo: number }> = [
  { name: 'Captrust Financial', firstDaysAgo: 88 },
  { name: 'Wealth Enhancement Group', firstDaysAgo: 81 },
  { name: 'Allworth Financial', firstDaysAgo: 72 },
  { name: 'Savant Wealth', firstDaysAgo: 66 },
  { name: 'Mercer Advisors', firstDaysAgo: 57 },
  { name: 'Carson Wealth', firstDaysAgo: 49 },
  { name: 'Aspiriant', firstDaysAgo: 41 },
  { name: 'Moneta Group', firstDaysAgo: 33 },
  { name: 'Brown Advisory', firstDaysAgo: 22 },
  { name: 'Silvercrest Asset Mgmt', firstDaysAgo: 14 },
];
// Registered before their real CRN was known (placeholder CRN, flagged pending).
const PENDING_CLIENTS: Array<{ name: string; firstDaysAgo: number }> = [
  { name: 'Summit Trail Partners', firstDaysAgo: 61 },
  { name: 'Harbor Light Wealth', firstDaysAgo: 38 },
  { name: 'Keystone Family Office', firstDaysAgo: 24 },
  { name: 'Bluewater Private Capital', firstDaysAgo: 11 },
];
// Registered in the client registry but not engaged yet.
const IDLE_CLIENTS = ['Evergreen Trust Co', 'Northstar Retirement Advisors'];

const crnOf = (n: number) => `CRN-${String(n).padStart(6, '0')}`;
const establishedClients: MockClient[] = ESTABLISHED.map((name, i) => ({ name, crn: crnOf(i + 1) }));
const newClients: MockClient[] = NEW_CLIENTS.map((c, i) => ({ ...c, crn: crnOf(ESTABLISHED.length + i + 1) }));
const pendingClients: MockClient[] = PENDING_CLIENTS.map((c, i) => ({
  ...c, crn: `PENDING-${String(i + 1).padStart(6, '0')}`, crnPending: true,
}));
const idleClients: MockClient[] = IDLE_CLIENTS.map((name, i) => ({
  name, crn: crnOf(ESTABLISHED.length + NEW_CLIENTS.length + i + 1),
}));

/** Clients registered with a placeholder CRN (seeded with crn_pending = 1). */
export const pendingCrnClients: string[] = pendingClients.map(c => c.crn);
/** Brand-new relationships (first engagement inside the last ~90 days). */
export const newClientCrns: string[] = newClients.map(c => c.crn);

/** A client the team could be working with on a given day. */
function clientFor(seed: number, daysAgo: number): MockClient {
  // New and pending clients join the random pool once onboarded, at a lower weight.
  if (seededRandom(seed) < 0.12) {
    const joined = [...newClients, ...pendingClients].filter(c => (c.firstDaysAgo ?? 0) > daysAgo);
    if (joined.length) return pick(joined, seed + 1);
  }
  return pick(establishedClients, seed + 2);
}

// =============================================================================
// PROJECT TYPES
// =============================================================================

// All eight built-in types for tracked projects (weighted by repetition), plus
// the custom type in the last year.
const projectTypes = [
  'Meeting', 'Discovery Meeting', 'Discovery Meeting', 'Data Request', 'Data Request',
  'Data Update', 'Data Update', 'PCR', 'PCR', 'PCR', 'Follow-up Material', 'Follow-up Meeting', 'Other',
];
const adHocProjectTypes = ['PCR', 'Discovery Meeting', 'Data Request', 'Data Update', 'Meeting', 'Other'];
const MEETING_TYPES = ['Meeting', 'Discovery Meeting', 'Follow-up Meeting'];

function durationFor(type: string, seed: number): number {
  const r = seededRandom(seed);
  if (type === 'PCR' || type === 'Due Diligence') return 5 + Math.floor(r * 11); // 5-15 days
  if (MEETING_TYPES.includes(type)) return 1 + Math.floor(r * 4);               // 1-4 days
  return 2 + Math.floor(r * 4);                                                  // 2-5 days
}

// Weighted department selection: Advisory 50%, Brokerage 30%, Institutional 11%, Retirement 9%
function getWeightedDepartment(seed: number): Dept {
  const rand = seededRandom(seed);
  if (rand < 0.50) return 'Advisory';
  if (rand < 0.80) return 'Brokerage';
  if (rand < 0.91) return 'Institutional';
  return 'Retirement';
}

function rosterClient(seed: number): { name: string; clientDept: Dept } {
  const dept = getWeightedDepartment(seed);
  return pick(internalRoster.filter(c => c.clientDept === dept), seed + 1);
}

// =============================================================================
// GENERATION
// =============================================================================

interface Draft extends Omit<MockEngagement, 'id' | 'linkedFromId' | 'projectId'> {
  daysAgo: number;
  order: number;
  parent?: Draft;
  hasProjectId: boolean;
  id?: number;
}

interface RowOptions {
  daysAgo: number;
  intakeType: string;
  type: string;
  client: MockClient;
  internalClient: { name: string; clientDept: Dept };
  status?: Status;
  staff?: { team: string | null; members: string[] };
  createdBy?: string | null;
  parent?: Draft;
  withPortfolio?: boolean;
  nnaChance?: number;
}

function generateEngagements(): MockEngagement[] {
  const drafts: Draft[] = [];
  let n = 0;

  // Anchor the 2-year window so it ends "today".
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOf = (daysAgo: number): Date => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d;
  };
  const display = (daysAgo: number): string =>
    dateOf(daysAgo).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  // Nudge a weekend date back to the previous Friday.
  const weekday = (daysAgo: number): number => {
    const dow = dateOf(daysAgo).getDay();
    return dow === 6 ? daysAgo + 1 : dow === 0 ? daysAgo + 2 : daysAgo;
  };

  const addRow = (o: RowOptions): Draft => {
    const seed = ++n * 17;
    const isAdHoc = o.intakeType === 'Ad-Hoc';
    const staff = o.staff ?? pickStaff(seed, o.daysAgo, isAdHoc ? 2 : 3);
    const duration = isAdHoc ? Math.floor(seededRandom(seed + 10) * 2) : durationFor(o.type, seed + 10);
    const finishAgo = o.daysAgo - duration;

    // Work finishing in the last 3 days still reads as open.
    let status: Status;
    if (o.status) status = o.status;
    else if (finishAgo < 3) status = MEETING_TYPES.includes(o.type) && seededRandom(seed + 11) < 0.5 ? 'Awaiting Meeting' : 'In Progress';
    else if (!isAdHoc && seededRandom(seed + 12) < 0.07) status = 'Follow Up'; // delivered, NNA outcome pending
    else status = 'Completed';
    const completed = status === 'Completed';

    // NNA only lands once work is completed (Follow Up = outcome still pending).
    const nnaChance = o.nnaChance ?? (isAdHoc ? 0.015 : 0.12);
    const nna = completed && seededRandom(seed + 13) < nnaChance ? generateNNA(o.internalClient.clientDept, seed + 14) : undefined;
    const nnaDetail = nna !== undefined ? generateNnaDetails(nna, seed + 15) : {};

    // Delivered, non-PCR client projects usually capture the client's model; the
    // rest often carry the prior model over unchanged (the sky-blue "Unchanged" state).
    const delivered = completed || status === 'Follow Up';
    const hasPortfolio = o.withPortfolio ?? (!isAdHoc && delivered && o.type !== 'PCR' && seededRandom(seed + 16) < 0.8);
    const unchanged = !hasPortfolio && !isAdHoc && delivered && o.type !== 'PCR' && seededRandom(seed + 17) < 0.5;

    const draft: Draft = {
      daysAgo: o.daysAgo,
      order: n,
      parent: o.parent,
      clientCrn: o.client.crn,
      crnPending: o.client.crnPending,
      externalClient: o.client.name,
      internalClient: o.internalClient,
      intakeType: o.intakeType,
      adHocChannel: isAdHoc ? pick(adHocChannels, seed + 18) : undefined,
      type: o.type,
      hasProjectId: seededRandom(seed + 19) < (isAdHoc ? 0.1 : 0.85),
      teamMembers: staff.members,
      team: staff.team,
      office: staff.members[0] ? teamMemberOffices[staff.members[0]] : null,
      createdByDisplay: o.createdBy !== undefined ? o.createdBy : staff.members[0] ?? null,
      department: o.internalClient.clientDept,
      dateStarted: display(o.daysAgo),
      dateFinished: completed ? display(Math.max(0, finishAgo)) : '—',
      status,
      portfolioLogged: hasPortfolio,
      portfolioUnchanged: unchanged,
      portfolio: hasPortfolio ? generatePortfolio(seed + 20) : undefined,
      nna,
      ...nnaDetail,
      notes: seededRandom(seed + 21) < 0.45 ? pick(sampleNotes, seed + 22) : undefined,
      tickersMentioned: isAdHoc && seededRandom(seed + 23) < 0.45 ? generateTickersMentioned(seed + 24) : undefined,
    };
    drafts.push(draft);
    return draft;
  };

  // ---------------------------------------------------------------------------
  // 1. Day-by-day baseline across two years (weekdays, slower holiday weeks)
  // ---------------------------------------------------------------------------
  const slowWeeks = [26, 47, 51, 52]; // July 4th, Thanksgiving, Christmas/New Year
  for (let daysAgo = 730; daysAgo >= 0; daysAgo--) {
    const date = dateOf(daysAgo);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const weekOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / (7 * 86400000)) + 1;
    const isSlowWeek = slowWeeks.includes(weekOfYear);
    const daySeed = daysAgo * 101;

    // Ad-Hoc: 2-3 per day normally, 0-1 during slow weeks
    const adHocToday = Math.max(0, Math.round((isSlowWeek ? 0.5 : 2.5) + seededRandom(daySeed) - 0.5));
    // Projects: ~4 per week, less during slow weeks
    const projectsToday = Math.max(0, Math.round((isSlowWeek ? 0.2 : 0.8) + (seededRandom(daySeed + 50) - 0.5) * 0.6));

    for (let i = 0; i < adHocToday; i++) {
      const s = daySeed + i * 13 + 1;
      addRow({
        daysAgo,
        intakeType: 'Ad-Hoc',
        type: pick(adHocProjectTypes, s),
        client: clientFor(s + 1, daysAgo),
        internalClient: rosterClient(s + 2),
      });
    }

    for (let i = 0; i < projectsToday; i++) {
      const s = daySeed + i * 29 + 500;
      // The custom type only exists for the last year (an admin added it).
      const type = daysAgo < 365 && seededRandom(s) < 0.05 ? 'Due Diligence' : pick(projectTypes, s + 1);
      addRow({
        daysAgo,
        intakeType: seededRandom(s + 2) > 0.5 ? 'IRQ' : 'SERF',
        type,
        client: clientFor(s + 3, daysAgo),
        internalClient: rosterClient(s + 4),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Funnels — Discovery Meeting → follow-up → PCR / Data Request, linked
  //    parent→child, for new/pending clients (their very first engagements) and
  //    a handful of established ones.
  // ---------------------------------------------------------------------------
  const buildChain = (client: MockClient, startAgo: number, seed: number) => {
    const ic = rosterClient(seed);
    const staff = pickStaff(seed + 1, startAgo, 2);
    const steps: Array<{ intake: string; type: string }> = [
      { intake: seededRandom(seed + 2) < 0.5 ? 'Ad-Hoc' : 'IRQ', type: 'Discovery Meeting' },
      { intake: 'IRQ', type: seededRandom(seed + 3) < 0.6 ? 'Follow-up Meeting' : 'Follow-up Material' },
      { intake: 'SERF', type: seededRandom(seed + 4) < 0.6 ? 'PCR' : 'Data Request' },
    ];
    let parent: Draft | undefined;
    let ago = startAgo;
    for (let i = 0; i < steps.length && ago >= 0; i++) {
      parent = addRow({
        daysAgo: weekday(ago),
        intakeType: steps[i].intake,
        type: steps[i].type,
        client,
        internalClient: ic,
        staff,
        parent,
        // The final PCR is where assets tend to move.
        nnaChance: i === 2 ? 0.45 : undefined,
      });
      ago -= 8 + Math.floor(seededRandom(seed + 10 + i) * 14);
    }
  };
  [...newClients, ...pendingClients].forEach((c, i) => buildChain(c, c.firstDaysAgo ?? 30, 7000 + i * 37));
  [3, 9, 14, 21, 27, 33].forEach((idx, i) => buildChain(establishedClients[idx], 120 + i * 95, 8000 + i * 41));

  // ---------------------------------------------------------------------------
  // 3. Open work — a few fresh meetings still being scheduled, plus stale items
  //    past the 3-week default threshold, several beyond 60 days (the Sankey
  //    "Stalled" outcome), mixed statuses and teams.
  // ---------------------------------------------------------------------------
  const stale: Array<{ daysAgo: number; status: Status; type: string; eli?: boolean }> = [
    { daysAgo: 5, status: 'Awaiting Meeting', type: 'Meeting', eli: true },
    { daysAgo: 9, status: 'Awaiting Meeting', type: 'Discovery Meeting' },
    { daysAgo: 13, status: 'Awaiting Meeting', type: 'Follow-up Meeting' },
    { daysAgo: 23, status: 'In Progress', type: 'Data Request' },
    { daysAgo: 31, status: 'Awaiting Meeting', type: 'Discovery Meeting' },
    { daysAgo: 38, status: 'In Progress', type: 'PCR', eli: true },
    { daysAgo: 47, status: 'In Progress', type: 'Data Update' },
    { daysAgo: 62, status: 'In Progress', type: 'Due Diligence' },
    { daysAgo: 78, status: 'Awaiting Meeting', type: 'Follow-up Meeting', eli: true },
    { daysAgo: 96, status: 'In Progress', type: 'PCR' },
    { daysAgo: 124, status: 'In Progress', type: 'Other' },
  ];
  stale.forEach((s, i) => {
    const seed = 9000 + i * 19;
    addRow({
      daysAgo: weekday(s.daysAgo),
      intakeType: i % 2 ? 'SERF' : 'IRQ',
      type: s.type,
      client: pick(establishedClients, seed),
      internalClient: rosterClient(seed + 1),
      status: s.status,
      staff: s.eli ? { team: 'Default Team', members: ['Eli F.', 'Blake N.'] } : undefined,
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Unassigned inbox — recent intake with no team and no members yet.
  // ---------------------------------------------------------------------------
  [1, 2, 4, 6, 9].forEach((ago, i) => {
    const seed = 9500 + i * 23;
    addRow({
      daysAgo: weekday(ago),
      intakeType: i % 2 ? 'SERF' : 'IRQ',
      type: pick(['Data Request', 'PCR', 'Meeting', 'Data Update'], seed),
      client: pick(establishedClients, seed + 1),
      internalClient: rosterClient(seed + 2),
      status: 'In Progress',
      staff: { team: null, members: [] },
      createdBy: 'Alex M.',
    });
  });

  // ---------------------------------------------------------------------------
  // 5. KPI fixtures keyed on INTERNAL relationship names (Q13 / Q14).
  //    • new internal clients  → first (and only) engagements inside the last ~11
  //      months, 2 each, so Q13's client base reads as "Growing".
  //    • dormant internal clients → 4 engagements that all stopped >60 days ago,
  //      earliest older than a year, so Q14 lists them, longest-silent first.
  // ---------------------------------------------------------------------------
  const fixture = (ic: { name: string; clientDept: Dept }, daysAgo: number, withPortfolio: boolean) => {
    const seed = 9800 + n * 7;
    addRow({
      daysAgo: weekday(daysAgo),
      intakeType: seededRandom(seed) > 0.5 ? 'IRQ' : 'SERF',
      type: pick(projectTypes, seed + 1),
      client: pick(establishedClients, seed + 2),
      internalClient: ic,
      status: 'Completed',
      withPortfolio,
      nnaChance: withPortfolio ? 1 : 0,
    });
  };

  const newInternal: Array<{ name: string; clientDept: Dept }> = [
    { name: 'Reese Calder', clientDept: 'Advisory' },
    { name: 'Sage Monroe', clientDept: 'Advisory' },
    { name: 'Teagan Wolfe', clientDept: 'Advisory' },
    { name: 'Presley Vance', clientDept: 'Brokerage' },
    { name: 'Oakley Shaw', clientDept: 'Brokerage' },
    { name: 'Micah Dunn', clientDept: 'Brokerage' },
    { name: 'Larkin Pace', clientDept: 'Institutional' },
    { name: 'Ira Boone', clientDept: 'Institutional' },
    { name: 'Wren Halloway', clientDept: 'Retirement' },
    { name: 'Sol Kramer', clientDept: 'Retirement' },
  ];
  newInternal.forEach((c, i) => {
    fixture(c, 300 - i * 28, i % 3 === 0); // first appearance, distinct recent months
    fixture(c, 8 + (i % 3) * 4, false);     // recent activity — still active
  });

  const dormantInternal: Array<{ name: string; clientDept: Dept; latest: number }> = [
    { name: 'Blaine Ortiz', clientDept: 'Brokerage', latest: 75 },
    { name: 'Rowan Pierce', clientDept: 'Advisory', latest: 130 },
    { name: 'Quinn Vega', clientDept: 'Institutional', latest: 210 },
    { name: 'Ellis Navarro', clientDept: 'Retirement', latest: 290 },
    { name: 'Harlow Quinn', clientDept: 'Advisory', latest: 400 },
  ];
  dormantInternal.forEach((c) => {
    const earliest = Math.max(400, c.latest + 160);
    const days = [earliest, Math.round((earliest * 2 + c.latest) / 3), Math.round((earliest + c.latest * 2) / 3), c.latest];
    days.forEach((d, i) => fixture(c, d, i === days.length - 1));
  });

  // ---------------------------------------------------------------------------
  // 6. One whale with a wide 12-ticker breakdown (exercises the long list UI).
  // ---------------------------------------------------------------------------
  const whale = drafts.find(d => (d.nna ?? 0) >= 500_000_000) ?? drafts.find(d => d.nna !== undefined);
  if (whale?.nna) Object.assign(whale, generateNnaDetails(whale.nna, 424242, 12));

  // ---------------------------------------------------------------------------
  // Assign ids in date order (so a parent always precedes its child), then
  // resolve funnel links and project IDs.
  // ---------------------------------------------------------------------------
  drafts.sort((a, b) => b.daysAgo - a.daysAgo || a.order - b.order);
  drafts.forEach((d, i) => { d.id = i + 1; });
  return drafts.map(({ daysAgo: _d, order: _o, parent, hasProjectId, id, ...rest }) => ({
    ...rest,
    id: id!,
    projectId: hasProjectId ? `PRJ-${String(1000 + id!).padStart(4, '0')}` : undefined,
    linkedFromId: parent?.id ?? null,
  }));
}

export const engagements: MockEngagement[] = generateEngagements();

// Client registry for the dev-without-db (mock) fallback and the seed script:
// every client that appears on an engagement, plus the registered-but-idle ones.
export const clients: Client[] = (() => {
  const byCrn = new Map<string, Client>();
  for (const e of engagements) {
    if (e.clientCrn && !byCrn.has(e.clientCrn)) {
      byCrn.set(e.clientCrn, { crn: e.clientCrn, name: e.externalClient, crnPending: e.crnPending });
    }
  }
  for (const c of idleClients) byCrn.set(c.crn, { crn: c.crn, name: c.name });
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
