// API functions for Ticker Trends Dashboard
// When connecting to FastAPI backend, replace mock implementations with fetch() calls

import type { HotTicker } from '../types/trends';
import type { BaseNote } from '../types/engagements';

// A ticker as authored in this mock file: `notes` is a single seed string that
// getHotTickers expands into a `noteEntries` list on the returned HotTicker.
type SeedTicker = Omit<HotTicker, 'noteEntries'> & { notes: string };

// Seed notes are attributed to team members (a small fixed roster keyed by rank).
const SEED_NOTE_AUTHORS = [
  { name: 'Maria Chen', id: 'seed-maria' },
  { name: 'David Park', id: 'seed-david' },
  { name: 'Sam Rivera', id: 'seed-sam' },
  { name: 'Priya Nair', id: 'seed-priya' },
];

// Extra seed notes so some matchups have several notes (shows off the note picker).
const EXTRA_SEED_NOTES: Record<string, string[]> = {
  IJR: [
    "Advisory says FMAS's profitability tilt lands well in QBRs — lead with factor exposure, not just the S&P 600 screen.",
    'Fee gap (6bps vs 27bps) keeps coming up. Pair it with FMAS net-flow momentum so it reads as value, not just cost.',
  ],
  VOO: [
    'Most VOO mentions are passing references in model reviews, not true head-to-head requests. Prioritize accordingly.',
  ],
  SCHD: [
    'Dividend-focused clients push back on FMLV yield — position it as systematic value / total return, not an income swap.',
    'Cooling fast this quarter. Decide whether to keep investing rep time here or reallocate toward IJR / VOO.',
  ],
  QQQ: [
    'No firm equivalent — steer toward FMUS as diversified core and set expectations on tech-concentration risk.',
  ],
};

function seedNoteEntries(t: SeedTicker): BaseNote[] {
  const texts: string[] = [];
  if (t.notes) texts.push(t.notes);
  texts.push(...(EXTRA_SEED_NOTES[t.ticker] ?? []));
  // Newest first (i = 0); each extra is authored by a different team member a few
  // days earlier, so the picker shows a distinct author · date per note.
  return texts.map((noteText, i) => {
    const a = SEED_NOTE_AUTHORS[(t.rank + i) % SEED_NOTE_AUTHORS.length];
    return {
      id: t.rank * 1000 + i + 1,
      noteText,
      authorName: a.name,
      authorId: a.id,
      createdAt: new Date(2026, 5, 30 - (t.rank % 20) - i * 4).toISOString(),
    };
  });
}

// =============================================================================
// API Configuration
// =============================================================================

// Simulate network delay for development (set to 0 for production)
const SIMULATED_DELAY = process.env.NODE_ENV === 'development' ? 200 : 0;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// =============================================================================
// Request/Response Types
// =============================================================================

export interface HotTickersFilters {
  department?: string;
  period?: string;
}

export interface HotTickersResponse {
  tickers: HotTicker[];
  total: number;
  asOfDate: string;
}

export interface FilterOptions {
  departments: string[];
  periods: string[];
}

// =============================================================================
// Mock Data
// =============================================================================

const mockHotTickers: SeedTicker[] = [
  {
    rank: 1,
    type: 'Challenging',
    ticker: 'IJR',
    name: 'iShares Core S&P Small-Cap',
    requests: 52,
    requestBreakdown: { pcrRequests: 24, pcrDownloads: 18, tickersMentioned: 7, clientModels: 3 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 28 }, { quarter: 'Q3 2022', requests: 31 },
      { quarter: 'Q4 2022', requests: 34 }, { quarter: 'Q1 2023', requests: 30 },
      { quarter: 'Q2 2023', requests: 36 }, { quarter: 'Q3 2023', requests: 39 },
      { quarter: 'Q4 2023', requests: 42 }, { quarter: 'Q1 2024', requests: 38 },
      { quarter: 'Q2 2024', requests: 56 }, { quarter: 'Q3 2024', requests: 48 },
      { quarter: 'Q4 2024', requests: 52 },
    ],
    trend: '+8%',
    firmCompetitor: 'FMAS',
    firmName: 'US Small Cap',
    returnComparison: { competitor: 12.4, firm: 9.8, delta: '-2.6%' },
    expenseRatio: { competitor: 0.06, firm: 0.27 },
    aum: { competitor: '82B', firm: '14B' },
    flows: { competitor: '+2.1B', firm: '+0.8B' },
    notes: 'IJR tracks S&P 600 which has profitability screens. FMAS has deeper small-cap exposure with value/profitability tilts. Key differentiator is factor exposure, not just market cap.',
    talkingPointsUrl: 'https://example.com/talking-points/ijr-vs-fmas',
    pcrUrl: 'https://example.com/pcr/ijr-vs-fmas',
    split: { Advisory: 21, Brokerage: 17, Institutional: 14 },
  },
  {
    rank: 2,
    type: 'Replacement',
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    requests: 47,
    requestBreakdown: { pcrRequests: 6, pcrDownloads: 3, tickersMentioned: 28, clientModels: 10 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 22 }, { quarter: 'Q3 2022', requests: 25 },
      { quarter: 'Q4 2022', requests: 29 }, { quarter: 'Q1 2023', requests: 27 },
      { quarter: 'Q2 2023', requests: 32 }, { quarter: 'Q3 2023', requests: 35 },
      { quarter: 'Q4 2023', requests: 33 }, { quarter: 'Q1 2024', requests: 37 },
      { quarter: 'Q2 2024', requests: 40 }, { quarter: 'Q3 2024', requests: 41 },
      { quarter: 'Q4 2024', requests: 47 },
    ],
    trend: '+12%',
    firmCompetitor: 'FMUS',
    firmName: 'US Core Equity 1',
    returnComparison: { competitor: 24.8, firm: 25.1, delta: '+0.3%' },
    expenseRatio: { competitor: 0.03, firm: 0.12 },
    aum: { competitor: '428B', firm: '32B' },
    flows: { competitor: '+18.5B', firm: '+3.2B' },
    notes: 'FMUS provides broader market exposure with systematic factor tilts. Similar large-cap core exposure but with the firm\'s research-driven approach.',
    talkingPointsUrl: 'https://example.com/talking-points/voo-vs-fmus',
    pcrUrl: 'https://example.com/pcr/voo-vs-fmus',
    split: { Advisory: 24, Brokerage: 15, Institutional: 8 },
  },
  {
    rank: 3,
    type: 'Replacement',
    ticker: 'VTI',
    name: 'Vanguard Total Stock Market',
    requests: 38,
    requestBreakdown: { pcrRequests: 10, pcrDownloads: 9, tickersMentioned: 10, clientModels: 9 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 20 }, { quarter: 'Q3 2022', requests: 23 },
      { quarter: 'Q4 2022', requests: 26 }, { quarter: 'Q1 2023', requests: 24 },
      { quarter: 'Q2 2023', requests: 28 }, { quarter: 'Q3 2023', requests: 30 },
      { quarter: 'Q4 2023', requests: 29 }, { quarter: 'Q1 2024', requests: 32 },
      { quarter: 'Q2 2024', requests: 40 }, { quarter: 'Q3 2024', requests: 42 },
      { quarter: 'Q4 2024', requests: 38 },
    ],
    trend: '-10%',
    firmCompetitor: 'FMUS',
    firmName: 'US Core Equity 1',
    returnComparison: { competitor: 24.2, firm: 25.1, delta: '+0.9%' },
    expenseRatio: { competitor: 0.03, firm: 0.12 },
    aum: { competitor: '389B', firm: '32B' },
    flows: { competitor: '+12.3B', firm: '+3.2B' },
    notes: '',
    talkingPointsUrl: 'https://example.com/talking-points/vti-vs-fmus',
    pcrUrl: '',
    split: { Advisory: 19, Brokerage: 12, Institutional: 7 },
  },
  {
    rank: 4,
    type: 'Complement',
    ticker: 'VXUS',
    name: 'Vanguard Total Intl Stock',
    requests: 31,
    requestBreakdown: { pcrRequests: 9, pcrDownloads: 0, tickersMentioned: 17, clientModels: 5 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 14 }, { quarter: 'Q3 2022', requests: 16 },
      { quarter: 'Q4 2022', requests: 19 }, { quarter: 'Q1 2023', requests: 17 },
      { quarter: 'Q2 2023', requests: 21 }, { quarter: 'Q3 2023', requests: 23 },
      { quarter: 'Q4 2023', requests: 29 }, { quarter: 'Q1 2024', requests: 34 },
      { quarter: 'Q2 2024', requests: 32 }, { quarter: 'Q3 2024', requests: 28 },
      { quarter: 'Q4 2024', requests: 31 },
    ],
    trend: '+11%',
    firmCompetitor: 'FMAI',
    firmName: 'Intl Core Equity',
    returnComparison: { competitor: 8.2, firm: 9.1, delta: '+0.9%' },
    expenseRatio: { competitor: 0.08, firm: 0.18 },
    aum: { competitor: '67B', firm: '12B' },
    flows: { competitor: '+4.2B', firm: '+1.1B' },
    notes: 'Can be used alongside FMAI for broader international coverage. FMAI provides factor tilts while VXUS offers pure market-cap weighting.',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 13, Brokerage: 9, Institutional: 9 },
  },
  {
    rank: 5,
    type: 'Replacement',
    ticker: 'BND',
    name: 'Vanguard Total Bond Market',
    requests: 28,
    requestBreakdown: { pcrRequests: 2, pcrDownloads: 1, tickersMentioned: 4, clientModels: 21 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 31 }, { quarter: 'Q3 2022', requests: 33 },
      { quarter: 'Q4 2022', requests: 35 }, { quarter: 'Q1 2023', requests: 32 },
      { quarter: 'Q2 2023', requests: 34 }, { quarter: 'Q3 2023', requests: 31 },
      { quarter: 'Q4 2023', requests: 30 }, { quarter: 'Q1 2024', requests: 29 },
      { quarter: 'Q2 2024', requests: 30 }, { quarter: 'Q3 2024', requests: 29 },
      { quarter: 'Q4 2024', requests: 28 },
    ],
    trend: '-3%',
    firmCompetitor: 'FMCF',
    firmName: 'Core Fixed Income',
    returnComparison: { competitor: 1.2, firm: 1.8, delta: '+0.6%' },
    expenseRatio: { competitor: 0.03, firm: 0.15 },
    aum: { competitor: '108B', firm: '8B' },
    flows: { competitor: '-1.8B', firm: '+0.4B' },
    notes: '',
    talkingPointsUrl: 'https://example.com/talking-points/bnd-vs-fmcf',
    pcrUrl: 'https://example.com/pcr/bnd-vs-fmcf',
    split: { Advisory: 8, Brokerage: 6, Institutional: 14 },
  },
  {
    rank: 6,
    type: 'Complement',
    ticker: 'VEA',
    name: 'Vanguard FTSE Developed Markets',
    requests: 24,
    requestBreakdown: { pcrRequests: 16, pcrDownloads: 5, tickersMentioned: 3, clientModels: 0 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 15 }, { quarter: 'Q3 2022', requests: 17 },
      { quarter: 'Q4 2022', requests: 18 }, { quarter: 'Q1 2023', requests: 16 },
      { quarter: 'Q2 2023', requests: 19 }, { quarter: 'Q3 2023', requests: 20 },
      { quarter: 'Q4 2023', requests: 21 }, { quarter: 'Q1 2024', requests: 20 },
      { quarter: 'Q2 2024', requests: 22 }, { quarter: 'Q3 2024', requests: 23 },
      { quarter: 'Q4 2024', requests: 24 },
    ],
    trend: '+5%',
    firmCompetitor: 'FMAI',
    firmName: 'Intl Core Equity',
    returnComparison: { competitor: 9.8, firm: 9.1, delta: '-0.7%' },
    expenseRatio: { competitor: 0.06, firm: 0.18 },
    aum: { competitor: '142B', firm: '12B' },
    flows: { competitor: '+5.6B', firm: '+1.1B' },
    notes: '',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 9, Brokerage: 6, Institutional: 9 },
  },
  {
    rank: 7,
    type: 'Challenging',
    ticker: 'SCHD',
    name: 'Schwab US Dividend Equity',
    requests: 21,
    requestBreakdown: { pcrRequests: 6, pcrDownloads: 7, tickersMentioned: 0, clientModels: 8 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 6 }, { quarter: 'Q3 2022', requests: 7 },
      { quarter: 'Q4 2022', requests: 9 }, { quarter: 'Q1 2023', requests: 8 },
      { quarter: 'Q2 2023', requests: 11 }, { quarter: 'Q3 2023', requests: 10 },
      { quarter: 'Q4 2023', requests: 13 }, { quarter: 'Q1 2024', requests: 14 },
      { quarter: 'Q2 2024', requests: 19 }, { quarter: 'Q3 2024', requests: 24 },
      { quarter: 'Q4 2024', requests: 21 },
    ],
    trend: '-13%',
    firmCompetitor: 'FMLV',
    firmName: 'US Large Cap Value',
    returnComparison: { competitor: 15.2, firm: 12.8, delta: '-2.4%' },
    expenseRatio: { competitor: 0.06, firm: 0.22 },
    aum: { competitor: '56B', firm: '9B' },
    flows: { competitor: '+8.9B', firm: '+0.6B' },
    notes: 'SCHD focuses on dividend growth quality. FMLV uses value/profitability factors. Different approaches - dividend yield vs systematic value exposure.',
    talkingPointsUrl: 'https://example.com/talking-points/schd-vs-fmlv',
    pcrUrl: 'https://example.com/pcr/schd-vs-fmlv',
    split: { Advisory: 6, Brokerage: 12, Institutional: 3 },
  },
  {
    rank: 8,
    type: 'Replacement',
    ticker: 'VWO',
    name: 'Vanguard FTSE Emerging Markets',
    requests: 19,
    requestBreakdown: { pcrRequests: 2, pcrDownloads: 1, tickersMentioned: 14, clientModels: 2 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 10 }, { quarter: 'Q3 2022', requests: 12 },
      { quarter: 'Q4 2022', requests: 14 }, { quarter: 'Q1 2023', requests: 13 },
      { quarter: 'Q2 2023', requests: 15 }, { quarter: 'Q3 2023', requests: 14 },
      { quarter: 'Q4 2023', requests: 16 }, { quarter: 'Q1 2024', requests: 17 },
      { quarter: 'Q2 2024', requests: 18 }, { quarter: 'Q3 2024', requests: 18 },
      { quarter: 'Q4 2024', requests: 19 },
    ],
    trend: '+7%',
    firmCompetitor: 'FMAE',
    firmName: 'Emerging Core Equity',
    returnComparison: { competitor: 6.4, firm: 7.2, delta: '+0.8%' },
    expenseRatio: { competitor: 0.08, firm: 0.21 },
    aum: { competitor: '82B', firm: '6B' },
    flows: { competitor: '+2.4B', firm: '+0.5B' },
    notes: '',
    talkingPointsUrl: 'https://example.com/talking-points/vwo-vs-fmae',
    pcrUrl: '',
    split: { Advisory: 7, Brokerage: 5, Institutional: 7 },
  },
  {
    rank: 9,
    type: 'Complement',
    ticker: 'AGG',
    name: 'iShares Core US Aggregate Bond',
    requests: 17,
    requestBreakdown: { pcrRequests: 0, pcrDownloads: 8, tickersMentioned: 2, clientModels: 7 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 19 }, { quarter: 'Q3 2022', requests: 21 },
      { quarter: 'Q4 2022', requests: 22 }, { quarter: 'Q1 2023', requests: 20 },
      { quarter: 'Q2 2023', requests: 21 }, { quarter: 'Q3 2023', requests: 19 },
      { quarter: 'Q4 2023', requests: 18 }, { quarter: 'Q1 2024', requests: 17 },
      { quarter: 'Q2 2024', requests: 18 }, { quarter: 'Q3 2024', requests: 17 },
      { quarter: 'Q4 2024', requests: 17 },
    ],
    trend: '-1%',
    firmCompetitor: 'FMCF',
    firmName: 'Core Fixed Income',
    returnComparison: { competitor: 1.0, firm: 1.8, delta: '+0.8%' },
    expenseRatio: { competitor: 0.03, firm: 0.15 },
    aum: { competitor: '98B', firm: '6B' },
    flows: { competitor: '-0.9B', firm: '+0.4B' },
    notes: '',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 4, Brokerage: 4, Institutional: 9 },
  },
  {
    rank: 10,
    type: 'Challenging',
    ticker: 'QQQ',
    name: 'Invesco QQQ Trust',
    requests: 15,
    requestBreakdown: { pcrRequests: 11, pcrDownloads: 3, tickersMentioned: 1, clientModels: 0 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 4 }, { quarter: 'Q3 2022', requests: 5 },
      { quarter: 'Q4 2022', requests: 6 }, { quarter: 'Q1 2023', requests: 5 },
      { quarter: 'Q2 2023', requests: 7 }, { quarter: 'Q3 2023', requests: 8 },
      { quarter: 'Q4 2023', requests: 7 }, { quarter: 'Q1 2024', requests: 12 },
      { quarter: 'Q2 2024', requests: 18 }, { quarter: 'Q3 2024', requests: 14 },
      { quarter: 'Q4 2024', requests: 15 },
    ],
    trend: '+7%',
    firmCompetitor: 'FMUS',
    firmName: 'US Core Equity 1',
    returnComparison: { competitor: 32.1, firm: 25.1, delta: '-7.0%' },
    expenseRatio: { competitor: 0.20, firm: 0.12 },
    aum: { competitor: '245B', firm: '32B' },
    flows: { competitor: '+21.3B', firm: '+3.2B' },
    notes: 'QQQ is Nasdaq-100 concentrated in tech. No direct firm equivalent. FMUS is diversified core. Different risk profiles - sector bet vs broad market.',
    talkingPointsUrl: 'https://example.com/talking-points/qqq-vs-fmus',
    pcrUrl: 'https://example.com/pcr/qqq-vs-fmus',
    split: { Advisory: 4, Brokerage: 9, Institutional: 2 },
  },
  {
    rank: 11,
    type: 'Replacement',
    ticker: 'DIA',
    name: 'SPDR Dow Jones Industrial',
    requests: 14,
    requestBreakdown: { pcrRequests: 5, pcrDownloads: 4, tickersMentioned: 4, clientModels: 1 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 9 }, { quarter: 'Q3 2022', requests: 10 },
      { quarter: 'Q4 2022', requests: 11 }, { quarter: 'Q1 2023', requests: 10 },
      { quarter: 'Q2 2023', requests: 12 }, { quarter: 'Q3 2023', requests: 12 },
      { quarter: 'Q4 2023', requests: 13 }, { quarter: 'Q1 2024', requests: 12 },
      { quarter: 'Q2 2024', requests: 14 }, { quarter: 'Q3 2024', requests: 13 },
      { quarter: 'Q4 2024', requests: 14 },
    ],
    trend: '+4%',
    firmCompetitor: 'FMUS',
    firmName: 'US Core Equity 1',
    returnComparison: { competitor: 18.9, firm: 25.1, delta: '+6.2%' },
    expenseRatio: { competitor: 0.16, firm: 0.12 },
    aum: { competitor: '34B', firm: '32B' },
    flows: { competitor: '+1.2B', firm: '+3.2B' },
    notes: '',
    talkingPointsUrl: 'https://example.com/talking-points/dia-vs-fmus',
    pcrUrl: '',
    split: { Advisory: 6, Brokerage: 5, Institutional: 3 },
  },
  {
    rank: 12,
    type: 'Challenging',
    ticker: 'IWM',
    name: 'iShares Russell 2000',
    requests: 13,
    requestBreakdown: { pcrRequests: 6, pcrDownloads: 4, tickersMentioned: 2, clientModels: 1 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 7 }, { quarter: 'Q3 2022', requests: 8 },
      { quarter: 'Q4 2022', requests: 9 }, { quarter: 'Q1 2023', requests: 8 },
      { quarter: 'Q2 2023', requests: 10 }, { quarter: 'Q3 2023', requests: 11 },
      { quarter: 'Q4 2023', requests: 12 }, { quarter: 'Q1 2024', requests: 11 },
      { quarter: 'Q2 2024', requests: 13 }, { quarter: 'Q3 2024', requests: 12 },
      { quarter: 'Q4 2024', requests: 13 },
    ],
    trend: '+9%',
    firmCompetitor: 'FMAS',
    firmName: 'US Small Cap',
    returnComparison: { competitor: 11.2, firm: 9.8, delta: '-1.4%' },
    expenseRatio: { competitor: 0.19, firm: 0.27 },
    aum: { competitor: '68B', firm: '14B' },
    flows: { competitor: '+3.1B', firm: '+0.8B' },
    notes: 'IWM is broad Russell 2000 with no quality screen. FMAS adds value/profitability tilts — cleaner small-cap exposure story.',
    talkingPointsUrl: 'https://example.com/talking-points/iwm-vs-fmas',
    pcrUrl: 'https://example.com/pcr/iwm-vs-fmas',
    split: { Advisory: 5, Brokerage: 6, Institutional: 2 },
  },
  {
    rank: 13,
    type: 'Complement',
    ticker: 'VIG',
    name: 'Vanguard Dividend Appreciation',
    requests: 11,
    requestBreakdown: { pcrRequests: 3, pcrDownloads: 3, tickersMentioned: 2, clientModels: 3 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 8 }, { quarter: 'Q3 2022', requests: 9 },
      { quarter: 'Q4 2022', requests: 10 }, { quarter: 'Q1 2023', requests: 9 },
      { quarter: 'Q2 2023', requests: 11 }, { quarter: 'Q3 2023', requests: 12 },
      { quarter: 'Q4 2023', requests: 11 }, { quarter: 'Q1 2024', requests: 12 },
      { quarter: 'Q2 2024', requests: 13 }, { quarter: 'Q3 2024', requests: 12 },
      { quarter: 'Q4 2024', requests: 11 },
    ],
    trend: '-2%',
    firmCompetitor: 'FMLV',
    firmName: 'US Large Cap Value',
    returnComparison: { competitor: 16.1, firm: 12.8, delta: '-3.3%' },
    expenseRatio: { competitor: 0.06, firm: 0.22 },
    aum: { competitor: '78B', firm: '9B' },
    flows: { competitor: '+4.8B', firm: '+0.6B' },
    notes: '',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 5, Brokerage: 3, Institutional: 3 },
  },
  {
    rank: 14,
    type: 'Complement',
    ticker: 'VNQ',
    name: 'Vanguard Real Estate',
    requests: 10,
    requestBreakdown: { pcrRequests: 2, pcrDownloads: 2, tickersMentioned: 3, clientModels: 3 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 5 }, { quarter: 'Q3 2022', requests: 6 },
      { quarter: 'Q4 2022', requests: 7 }, { quarter: 'Q1 2023', requests: 6 },
      { quarter: 'Q2 2023', requests: 8 }, { quarter: 'Q3 2023', requests: 8 },
      { quarter: 'Q4 2023', requests: 9 }, { quarter: 'Q1 2024', requests: 9 },
      { quarter: 'Q2 2024', requests: 10 }, { quarter: 'Q3 2024', requests: 9 },
      { quarter: 'Q4 2024', requests: 10 },
    ],
    trend: '+6%',
    firmCompetitor: 'FMRE',
    firmName: 'Real Estate Securities',
    returnComparison: { competitor: 9.4, firm: 8.1, delta: '-1.3%' },
    expenseRatio: { competitor: 0.13, firm: 0.28 },
    aum: { competitor: '34B', firm: '3B' },
    flows: { competitor: '-0.6B', firm: '+0.2B' },
    notes: '',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 3, Brokerage: 3, Institutional: 4 },
  },
  {
    rank: 15,
    type: 'Challenging',
    ticker: 'GLD',
    name: 'SPDR Gold Shares',
    requests: 9,
    requestBreakdown: { pcrRequests: 4, pcrDownloads: 2, tickersMentioned: 3, clientModels: 0 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 3 }, { quarter: 'Q3 2022', requests: 4 },
      { quarter: 'Q4 2022', requests: 4 }, { quarter: 'Q1 2023', requests: 5 },
      { quarter: 'Q2 2023', requests: 6 }, { quarter: 'Q3 2023', requests: 6 },
      { quarter: 'Q4 2023', requests: 7 }, { quarter: 'Q1 2024', requests: 8 },
      { quarter: 'Q2 2024', requests: 10 }, { quarter: 'Q3 2024', requests: 8 },
      { quarter: 'Q4 2024', requests: 9 },
    ],
    trend: '+11%',
    firmCompetitor: 'FMRA',
    firmName: 'Real Assets',
    returnComparison: { competitor: 26.7, firm: 25.1, delta: '-1.6%' },
    expenseRatio: { competitor: 0.40, firm: 0.12 },
    aum: { competitor: '73B', firm: '32B' },
    flows: { competitor: '+6.4B', firm: '+3.2B' },
    notes: 'GLD is physical gold — no firm equity/bond equivalent. Position FMRA (real assets) as a diversifier, not a like-for-like swap.',
    talkingPointsUrl: 'https://example.com/talking-points/gld-vs-fmra',
    pcrUrl: '',
    split: { Advisory: 2, Brokerage: 5, Institutional: 2 },
  },
  {
    rank: 16,
    type: 'Complement',
    ticker: 'EFA',
    name: 'iShares MSCI EAFE',
    requests: 8,
    requestBreakdown: { pcrRequests: 3, pcrDownloads: 2, tickersMentioned: 2, clientModels: 1 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 5 }, { quarter: 'Q3 2022', requests: 5 },
      { quarter: 'Q4 2022', requests: 6 }, { quarter: 'Q1 2023', requests: 5 },
      { quarter: 'Q2 2023', requests: 6 }, { quarter: 'Q3 2023', requests: 7 },
      { quarter: 'Q4 2023', requests: 7 }, { quarter: 'Q1 2024', requests: 6 },
      { quarter: 'Q2 2024', requests: 8 }, { quarter: 'Q3 2024', requests: 7 },
      { quarter: 'Q4 2024', requests: 8 },
    ],
    trend: '+3%',
    firmCompetitor: 'FMAI',
    firmName: 'Intl Core Equity',
    returnComparison: { competitor: 8.9, firm: 9.1, delta: '+0.2%' },
    expenseRatio: { competitor: 0.32, firm: 0.18 },
    aum: { competitor: '54B', firm: '12B' },
    flows: { competitor: '+1.1B', firm: '+1.1B' },
    notes: '',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 3, Brokerage: 3, Institutional: 2 },
  },
  {
    rank: 17,
    type: 'Replacement',
    ticker: 'LQD',
    name: 'iShares iBoxx IG Corp Bond',
    requests: 7,
    requestBreakdown: { pcrRequests: 1, pcrDownloads: 1, tickersMentioned: 1, clientModels: 4 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 9 }, { quarter: 'Q3 2022', requests: 9 },
      { quarter: 'Q4 2022', requests: 8 }, { quarter: 'Q1 2023', requests: 8 },
      { quarter: 'Q2 2023', requests: 7 }, { quarter: 'Q3 2023', requests: 7 },
      { quarter: 'Q4 2023', requests: 7 }, { quarter: 'Q1 2024', requests: 6 },
      { quarter: 'Q2 2024', requests: 7 }, { quarter: 'Q3 2024', requests: 6 },
      { quarter: 'Q4 2024', requests: 7 },
    ],
    trend: '-4%',
    firmCompetitor: 'FMCF',
    firmName: 'Core Fixed Income',
    returnComparison: { competitor: 2.1, firm: 1.8, delta: '-0.3%' },
    expenseRatio: { competitor: 0.14, firm: 0.15 },
    aum: { competitor: '31B', firm: '8B' },
    flows: { competitor: '-0.4B', firm: '+0.4B' },
    notes: '',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 2, Brokerage: 1, Institutional: 4 },
  },
  {
    rank: 18,
    type: 'Challenging',
    ticker: 'TLT',
    name: 'iShares 20+ Year Treasury',
    requests: 6,
    requestBreakdown: { pcrRequests: 2, pcrDownloads: 1, tickersMentioned: 2, clientModels: 1 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 8 }, { quarter: 'Q3 2022', requests: 7 },
      { quarter: 'Q4 2022', requests: 7 }, { quarter: 'Q1 2023', requests: 6 },
      { quarter: 'Q2 2023', requests: 6 }, { quarter: 'Q3 2023', requests: 5 },
      { quarter: 'Q4 2023', requests: 5 }, { quarter: 'Q1 2024', requests: 6 },
      { quarter: 'Q2 2024', requests: 7 }, { quarter: 'Q3 2024', requests: 5 },
      { quarter: 'Q4 2024', requests: 6 },
    ],
    trend: '+5%',
    firmCompetitor: 'FMCF',
    firmName: 'Core Fixed Income',
    returnComparison: { competitor: -1.2, firm: 1.8, delta: '+3.0%' },
    expenseRatio: { competitor: 0.15, firm: 0.15 },
    aum: { competitor: '48B', firm: '8B' },
    flows: { competitor: '+2.9B', firm: '+0.4B' },
    notes: 'TLT is long-duration Treasuries — a rate bet. FMCF is core aggregate. Frame as duration positioning, not a swap.',
    talkingPointsUrl: 'https://example.com/talking-points/tlt-vs-fmcf',
    pcrUrl: '',
    split: { Advisory: 2, Brokerage: 2, Institutional: 2 },
  },
  {
    rank: 19,
    type: 'Challenging',
    ticker: 'ARKK',
    name: 'ARK Innovation ETF',
    requests: 5,
    requestBreakdown: { pcrRequests: 4, pcrDownloads: 1, tickersMentioned: 0, clientModels: 0 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 2 }, { quarter: 'Q3 2022', requests: 3 },
      { quarter: 'Q4 2022', requests: 3 }, { quarter: 'Q1 2023', requests: 2 },
      { quarter: 'Q2 2023', requests: 3 }, { quarter: 'Q3 2023', requests: 3 },
      { quarter: 'Q4 2023', requests: 4 }, { quarter: 'Q1 2024', requests: 4 },
      { quarter: 'Q2 2024', requests: 6 }, { quarter: 'Q3 2024', requests: 4 },
      { quarter: 'Q4 2024', requests: 5 },
    ],
    trend: '+9%',
    firmCompetitor: 'FMUS',
    firmName: 'US Core Equity 1',
    returnComparison: { competitor: 28.4, firm: 25.1, delta: '-3.3%' },
    expenseRatio: { competitor: 0.75, firm: 0.12 },
    aum: { competitor: '8B', firm: '32B' },
    flows: { competitor: '+1.4B', firm: '+3.2B' },
    notes: 'ARKK is concentrated disruptive-innovation. No firm equivalent. FMUS is diversified core — a different risk profile entirely.',
    talkingPointsUrl: 'https://example.com/talking-points/arkk-vs-fmus',
    pcrUrl: '',
    split: { Advisory: 2, Brokerage: 3, Institutional: 0 },
  },
  {
    rank: 20,
    type: 'Challenging',
    ticker: 'XLK',
    name: 'Technology Select Sector SPDR',
    requests: 4,
    requestBreakdown: { pcrRequests: 3, pcrDownloads: 1, tickersMentioned: 0, clientModels: 0 },
    quarterlyRequests: [
      { quarter: 'Q2 2022', requests: 2 }, { quarter: 'Q3 2022', requests: 2 },
      { quarter: 'Q4 2022', requests: 3 }, { quarter: 'Q1 2023', requests: 2 },
      { quarter: 'Q2 2023', requests: 3 }, { quarter: 'Q3 2023', requests: 3 },
      { quarter: 'Q4 2023', requests: 3 }, { quarter: 'Q1 2024', requests: 3 },
      { quarter: 'Q2 2024', requests: 5 }, { quarter: 'Q3 2024', requests: 3 },
      { quarter: 'Q4 2024', requests: 4 },
    ],
    trend: '+6%',
    firmCompetitor: 'FMUS',
    firmName: 'US Core Equity 1',
    returnComparison: { competitor: 30.2, firm: 25.1, delta: '-5.1%' },
    expenseRatio: { competitor: 0.09, firm: 0.12 },
    aum: { competitor: '62B', firm: '32B' },
    flows: { competitor: '+3.8B', firm: '+3.2B' },
    notes: '',
    talkingPointsUrl: '',
    pcrUrl: '',
    split: { Advisory: 1, Brokerage: 2, Institutional: 1 },
  },
];

// =============================================================================
// API Functions
// =============================================================================

/**
 * Fetch top 10 hot tickers with firm competitors
 * Returns pre-computed data from the backend
 */
export async function getHotTickers(_filters?: HotTickersFilters): Promise<HotTickersResponse> {
  if (SIMULATED_DELAY) await delay(SIMULATED_DELAY);

  return {
    tickers: mockHotTickers.map((t) => {
      const { notes: _notes, ...rest } = t;
      return { ...rest, noteEntries: seedNoteEntries(t) };
    }),
    total: mockHotTickers.length,
    asOfDate: new Date().toISOString().split('T')[0],
  };
}

/**
 * Get filter options for the ticker trends dashboard
 */
export async function getTickerTrendsFilterOptions(): Promise<FilterOptions> {
  if (SIMULATED_DELAY) await delay(SIMULATED_DELAY);

  return {
    departments: ['All Departments', 'Advisory', 'Brokerage', 'Institutional'],
    periods: ['1M', '3M', '6M', '1Y', 'YTD', 'All'],
  };
}

// =============================================================================
// Update Functions
// =============================================================================

export type TickerType = 'Replacement' | 'Challenging' | 'Complement';

export const TICKER_TYPE_OPTIONS: TickerType[] = ['Replacement', 'Challenging', 'Complement'];

/**
 * Update the type classification for a hot ticker
 * Returns the updated ticker on success
 */
export async function updateHotTickerType(
  ticker: string,
  newType: TickerType
): Promise<{ success: boolean; ticker: string; type: TickerType }> {
  if (SIMULATED_DELAY) await delay(SIMULATED_DELAY);

  return {
    success: true,
    ticker,
    type: newType,
  };
}

/**
 * Update the talking points URL for a hot ticker
 * Returns the updated ticker on success
 */
export async function updateHotTickerTalkingPoints(
  ticker: string,
  talkingPointsUrl: string
): Promise<{ success: boolean; ticker: string; talkingPointsUrl: string }> {
  if (SIMULATED_DELAY) await delay(SIMULATED_DELAY);

  return {
    success: true,
    ticker,
    talkingPointsUrl,
  };
}

/**
 * Update the PCR URL for a hot ticker
 * Returns the updated ticker on success
 */
export async function updateHotTickerPCR(
  ticker: string,
  pcrUrl: string
): Promise<{ success: boolean; ticker: string; pcrUrl: string }> {
  if (SIMULATED_DELAY) await delay(SIMULATED_DELAY);

  return {
    success: true,
    ticker,
    pcrUrl,
  };
}
