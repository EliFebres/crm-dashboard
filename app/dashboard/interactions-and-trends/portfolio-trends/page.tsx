'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Building2, Info, Landmark, Layers, PieChart, Users } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import BenchmarkBarChart from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/BenchmarkBarChart';
import AssetClassFilterButton, { type EquityScope } from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/AssetClassFilterButton';
import {
  loggedPortfolios,
  filterPortfolios,
  computeBenchmarkComparison,
} from '@/app/lib/data/portfolioTrends';
import type { BenchmarkComparison } from '@/app/lib/types/trends';
import DashboardHeader from '@/app/components/dashboard/shared/DashboardHeader';

// Static filter options. Filter selection is purely cosmetic on this dashboard
// for now; the underlying portfolio data is dummy and not yet wired up.
const TEAMS = ['Portfolio Consulting', 'Equity Specialists', 'Fixed Income Specialists'];
const DEPARTMENTS = ['Brokerage', 'Advisory', 'Institutional', 'Retirement'];

// Portfolios selector — drives which series render on the cards. Avg. Client is the
// default; Core+ Model is a firm-defined model portfolio.
const PORTFOLIO_OPTIONS = ['Avg. Client', 'Core+ Model'] as const;
type PortfolioName = typeof PORTFOLIO_OPTIONS[number];
type DisplayedPortfolio = {
  name: PortfolioName;
  idx: number;
  exiting: boolean;
  // `entering` marks rows added on a 1→N transition so they play row-enter (delayed grow) instead
  // of data-pop. `settled` marks rows whose row-enter has finished — those render with no
  // animation class so data-pop doesn't re-fire (which would briefly snap the row to opacity 0).
  entering?: boolean;
  settled?: boolean;
};
type DeltaState = 'visible' | 'exiting' | 'hidden';

// Duration of the slowest exit animation + the deferred React unmount that follows.
// The Credit Breakdown card's staged 2→1 exit (bar-shrink + label-exit + row-exit) ends
// at 1.5s, so cleanup waits that long before sweeping the row from the DOM. Cards with
// faster exits (data-fade at 0.4s, col-collapse at 1.2s) just sit at their final state
// for the remaining time, which is invisible.
const PORTFOLIO_EXIT_MS = 1500;

// Row-to-row stagger for the Portfolio Trends grid: row 2's animations (col-expand,
// data-pop, data-fade, benchmark bar rise/shrink, radar polygon) all start this many ms
// after row 1's. Must match the 1s in the .row-stagger-2 rules in globals.css.
const ROW_2_STAGGER_MS = 1000;

// Row 3 (Fixed Income — FI Metrics + Yield Curve) keeps the same 1s cadence — its
// data-pop / col-expand animations start once row 2's data-pop is mostly done. Must
// match the 2s in the .row-stagger-3 rules in globals.css.
const ROW_3_STAGGER_MS = 2000;

// Row 4 (Fixed Income — Credit Breakdown + Credit Spread) sits one cadence below row 3.
// Must match the 3s in the .row-stagger-4 rules in globals.css.
const ROW_4_STAGGER_MS = 3000;

// Row 5 (Fixed Income — Security Type) sits one cadence below row 4.
// Must match the 4s in the .row-stagger-5 rules in globals.css.
const ROW_5_STAGGER_MS = 4000;

// Row 6 (Fixed Income — Maturity Breakdown) sits one cadence below row 5.
// Must match the 5s in the .row-stagger-6 rules in globals.css.
const ROW_6_STAGGER_MS = 5000;

// Duration of the .section-exit animation defined in globals.css. Asset Class filter
// keeps a deselected section mounted this long so its fade-out + collapse can play
// before React sweeps it from the DOM.
const SECTION_EXIT_MS = 1000;

type SectionVisibility = 'visible' | 'exiting' | 'hidden';

// Drives a top-level section's mount/unmount around the .section-exit animation.
// `active=true` → 'visible' immediately. `active=false` while currently visible →
// 'exiting' for SECTION_EXIT_MS, then 'hidden' (caller unmounts).
function useSectionVisibility(active: boolean): SectionVisibility {
  const [state, setState] = useState<SectionVisibility>(active ? 'visible' : 'hidden');
  useEffect(() => {
    if (active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState('visible');
    } else {
      setState(prev => (prev === 'visible' ? 'exiting' : prev));
    }
  }, [active]);
  useEffect(() => {
    if (state !== 'exiting') return;
    const t = setTimeout(() => setState('hidden'), SECTION_EXIT_MS);
    return () => clearTimeout(t);
  }, [state]);
  return state;
}

// Color is tied to selection order, not portfolio name. Whichever portfolio is selected
// first gets palette[0], the next selection gets palette[1]. Avg. Client is the default
// first selection so it lands on palette[0] until the user reshuffles selections.
const PORTFOLIO_PALETTE: ReadonlyArray<{ hex: string; glow: string }> = [
  { hex: '#1398A4', glow: 'rgba(19, 152, 164, 0.45)' },
  { hex: '#BFD22B', glow: 'rgba(191, 210, 43, 0.3)' },
];

// Maps a value on a [min, max] axis to a CSS percentage offset.
// Use invert=true for the Y axis: top:0% is the top of the container, but the axis max sits at the top.
const pct = (value: number, min: number, max: number, invert = false) => {
  const ratio = (value - min) / (max - min);
  return `${(invert ? 1 - ratio : ratio) * 100}%`;
};

// Returns the N most recent completed quarter-end labels (e.g. "Q1 2026", "Q4 2025", ...).
function getRecentQuarterEnds(count: number): string[] {
  const now = new Date();
  let q = Math.floor(now.getMonth() / 3) + 1; // 1-4 for current (in-progress) quarter
  let y = now.getFullYear();
  // Step back to the most recent completed quarter
  q -= 1;
  if (q === 0) { q = 4; y -= 1; }

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(`Q${q} ${y}`);
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return result;
}

// Delta-column visibility for the Metrics vs Index and Style × Profitability cards. Both
// want delta columns when there's room and drop them (with col-collapse animation) when
// the viewport is too narrow to fit a 2nd portfolio + 2 delta columns alongside everything
// else in the row. Driven off viewport width (not card content width) because the Style ×
// Profitability card shares its row with a radar chart whose layout would otherwise muddy
// the "is there room?" signal.
//
// Hand-off sequencing in compact mode (mirrors PORTFOLIO_EXIT_MS):
//   add 2nd portfolio   → delta columns col-collapse (1.2s) → 2nd portfolio col-expands (1.2s)
//   remove 2nd portfolio → 2nd portfolio col-collapses (1.2s) → delta columns col-expand (1.2s)
function useDeltaColumns(
  viewportThreshold: number,
  displayedPortfolios: DisplayedPortfolio[],
  portfolioFilter: readonly PortfolioName[],
) {
  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${viewportThreshold - 1}px)`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCompact(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsCompact(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [viewportThreshold]);

  const wantHidden = isCompact && portfolioFilter.length > 1;
  const [deltaState, setDeltaState] = useState<DeltaState>(wantHidden ? 'hidden' : 'visible');
  useEffect(() => {
    if (wantHidden) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeltaState(prev => (prev === 'visible' ? 'exiting' : prev));
    } else {
      // Wait until the dying portfolio column has fully unmounted before showing deltas back,
      // so it col-collapses alone before the deltas col-expand into the freed space.
      if (displayedPortfolios.some(p => p.exiting)) return;
      setDeltaState(prev => (prev === 'visible' ? prev : 'visible'));
    }
  }, [wantHidden, displayedPortfolios]);
  useEffect(() => {
    if (deltaState !== 'exiting') return;
    const t = setTimeout(() => setDeltaState('hidden'), PORTFOLIO_EXIT_MS);
    return () => clearTimeout(t);
  }, [deltaState]);

  // While the card is compact and a hand-off is in flight (deltas visible or exiting), keep
  // newly-added portfolios out of *this* card's render so the deltas finish col-collapsing
  // before the 2nd portfolio's column mounts and col-expands.
  const visiblePortfolios = (isCompact && deltaState !== 'hidden' && portfolioFilter[0])
    ? displayedPortfolios.filter(p => p.name === portfolioFilter[0])
    : displayedPortfolios;

  return { deltaState, visiblePortfolios };
}

export default function PortfolioTrendsDashboard() {
  // Filter state
  const [teamFilter, setTeamFilter] = useState('All Teams');
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [portfolioFilter, setPortfolioFilterRaw] = useState<PortfolioName[]>(['Avg. Client']);
  const quarterEndOptions = useMemo(() => getRecentQuarterEnds(8), []);
  const [period, setPeriod] = useState(quarterEndOptions[0]);

  // Asset class filter — independent radio (equity scope) + checkbox (fixed income),
  // with a hard floor that at least one bucket is always active. Floor enforcement
  // also lives inside AssetClassFilterButton's click handlers; the setter wrappers
  // here are a defense-in-depth in case any caller bypasses the component handlers.
  const [equityScope, setEquityScopeRaw] = useState<EquityScope | null>('Total');
  const [fixedIncomeOn, setFixedIncomeOnRaw] = useState(true);
  const setEquityScope = (next: EquityScope | null) => {
    if (next === null && !fixedIncomeOn) setFixedIncomeOnRaw(true);
    setEquityScopeRaw(next);
  };
  const setFixedIncomeOn = (next: boolean) => {
    if (!next && equityScope === null) setEquityScopeRaw('Total');
    setFixedIncomeOnRaw(next);
  };
  // Hold onto the last non-null equity scope so the title stays stable while the
  // equity section is mid-exit-animation (where equityScope itself is already null).
  const lastEquityScopeRef = useRef<EquityScope>(equityScope ?? 'Total');
  useEffect(() => {
    if (equityScope !== null) lastEquityScopeRef.current = equityScope;
  }, [equityScope]);
  const equityVisibility = useSectionVisibility(equityScope !== null);
  const fixedIncomeVisibility = useSectionVisibility(fixedIncomeOn);
  // Title scope: stays on the last non-null value while the equity section is mid-exit,
  // so the heading doesn't drop its prefix during the 1s collapse animation.
  const titleEquityScope: EquityScope = equityScope ?? lastEquityScopeRef.current;

  // Always keep at least one portfolio selected — snap back to Avg. Client on empty.
  const setPortfolioFilter = (next: string[]) => {
    setPortfolioFilterRaw(next.length === 0 ? ['Avg. Client'] : (next as PortfolioName[]));
  };

  // Deferred-unmount list driving every portfolio-keyed render (dots, bars, polygons, table cells).
  // When a portfolio is deselected we keep its row here with `exiting: true` for the duration of the
  // fade-out, then sweep it out, so visuals animate away instead of disappearing on the next render.
  const [displayedPortfolios, setDisplayedPortfolios] = useState<DisplayedPortfolio[]>(
    () => portfolioFilter.map((name, idx) => ({ name, idx, exiting: false }))
  );
  // Tracks the previous filter length so we can flag rows added on a 1→N transition as `entering`.
  // Only the Credit Breakdown card uses this flag (to stage thin-then-grow); other cards ignore it.
  const prevFilterLengthRef = useRef(portfolioFilter.length);
  useEffect(() => {
    const wasOne = prevFilterLengthRef.current === 1 && portfolioFilter.length > 1;
    setDisplayedPortfolios(prev => {
      const next: DisplayedPortfolio[] = [];
      prev.forEach(p => {
        const newIdx = portfolioFilter.indexOf(p.name);
        if (newIdx !== -1) {
          // Still selected — refresh idx and clear any pending exit. Spread `...p` so flags like
          // `entering` / `settled` survive (otherwise a mid-flight filter change would drop them
          // and the row's className would flip back to data-pop, replaying its fade-in).
          next.push({ ...p, idx: newIdx, exiting: false });
        } else if (!p.exiting) {
          // Newly deselected — start fade, keep old idx so its color stays stable through the fade.
          next.push({ ...p, exiting: true });
        } else {
          // Already exiting and still gone — keep until cleanup timer removes it.
          next.push(p);
        }
      });
      portfolioFilter.forEach((name, idx) => {
        if (!next.find(p => p.name === name)) {
          next.push({ name, idx, exiting: false, entering: wasOne });
        }
      });
      return next;
    });
    prevFilterLengthRef.current = portfolioFilter.length;
  }, [portfolioFilter]);
  useEffect(() => {
    if (!displayedPortfolios.some(p => p.exiting)) return;
    const t = setTimeout(() => {
      setDisplayedPortfolios(prev => prev.filter(p => !p.exiting));
    }, PORTFOLIO_EXIT_MS);
    return () => clearTimeout(t);
  }, [displayedPortfolios]);
  // Clears `entering` once phase 2 finishes — bar-grow + label-enter both end at
  // 0.9s delay + 1.5s duration = 2400ms (row-enter at 0.8s ends earlier and is also done by then).
  // Marks the row `settled` so the className flip doesn't replay data-pop's fade-in.
  useEffect(() => {
    if (!displayedPortfolios.some(p => p.entering)) return;
    const t = setTimeout(() => {
      setDisplayedPortfolios(prev =>
        prev.map(p => (p.entering ? { ...p, entering: false, settled: true } : p))
      );
    }, 2400);
    return () => clearTimeout(t);
  }, [displayedPortfolios]);

  // Shared delta-column hand-off — both the Metrics vs Index and Style × Profitability cards
  // switch on the same viewport breakpoint, so a single hook call drives both renderings.
  const { deltaState, visiblePortfolios } = useDeltaColumns(
    1600, displayedPortfolios, portfolioFilter
  );


  // XY chart data — drives dot positions, crosshair positions, and tooltip text.
  const styleXY = {
    x: { min: 2.0, max: 4.0, format: (v: number) => v.toFixed(1) },
    y: { min: 200, max: 600, format: (v: number) => `$${v}B` },
    benchmark: { name: 'MSCI ACWI IMI', x: 3.2, y: 460 },
    portfolios: {
      'Avg. Client': { x: 2.90, y: 400 },
      'Core+ Model': { x: 2.75, y: 425 },
    } as Record<PortfolioName, { x: number; y: number }>,
  };
  const profitabilityXY = {
    x: { min: 2.0, max: 4.0, format: (v: number) => v.toFixed(2) },
    y: { min: 0.30, max: 0.60, format: (v: number) => v.toFixed(2) },
    benchmark: { name: 'MSCI ACWI IMI', x: 3.10, y: 0.48 },
    portfolios: {
      'Avg. Client': { x: 2.84, y: 0.50 },
      'Core+ Model': { x: 2.70, y: 0.46 },
    } as Record<PortfolioName, { x: number; y: number }>,
  };

  // Cap allocations — index and per-portfolio Large/Mid/Small Cap weights in %.
  const CAP_BUCKETS = ['Large Cap', 'Mid Cap', 'Small Cap'] as const;
  type CapBucket = typeof CAP_BUCKETS[number];
  const capAllocation: {
    index: Record<CapBucket, number>;
    portfolios: Record<PortfolioName, Record<CapBucket, number>>;
  } = {
    index:       { 'Large Cap': 60, 'Mid Cap': 25, 'Small Cap': 15 },
    portfolios: {
      'Avg. Client': { 'Large Cap': 65, 'Mid Cap': 22, 'Small Cap': 13 },
      'Core+ Model': { 'Large Cap': 54, 'Mid Cap': 28, 'Small Cap': 18 },
    },
  };

  // Style x Profitability — four sub-buckets per portfolio, summing to 100%. Growth and Value
  // totals shown in the right-hand table are derived as HighProf + LowProf.
  type StyleProfCategory = 'Growth High-Prof' | 'Growth Low-Prof' | 'Value High-Prof' | 'Value Low-Prof';
  const styleProfitability: {
    index: Record<StyleProfCategory, number>;
    portfolios: Record<PortfolioName, Record<StyleProfCategory, number>>;
  } = {
    index:       { 'Growth High-Prof': 30, 'Growth Low-Prof': 22, 'Value High-Prof': 28, 'Value Low-Prof': 20 },
    portfolios: {
      'Avg. Client': { 'Growth High-Prof': 32, 'Growth Low-Prof': 18, 'Value High-Prof': 30, 'Value Low-Prof': 20 },
      'Core+ Model': { 'Growth High-Prof': 35, 'Growth Low-Prof': 12, 'Value High-Prof': 35, 'Value Low-Prof': 18 },
    },
  };
  // Holdings-count mock data for the metrics-vs-index table (the other rows reuse the
  // values already powering the XY / Style × Profitability cards).
  const companyCounts: { index: number; portfolios: Record<PortfolioName, number> } = {
    index: 8800,
    portfolios: { 'Avg. Client': 245, 'Core+ Model': 78 },
  };

  // ============= FIXED INCOME MOCK DATA =============
  // Distributions sum to 100. Index = Bloomberg US Aggregate (Treasury + agency-heavy → AAA-skewed).
  // textColor is paired per-bucket so the in-bar % label always has enough contrast against
  // the segment fill (dark fills get white text, light fills get near-black).
  type CreditBucket = 'AAA' | 'AA' | 'A' | 'BBB' | 'BelowBBB' | 'NotRated' | 'Other';
  const CREDIT_BUCKETS: ReadonlyArray<{ id: CreditBucket; label: string; color: string; textColor: string }> = [
    { id: 'AAA',      label: 'AAA',       color: '#3d7d27', textColor: '#ffffff' },
    { id: 'AA',       label: 'AA',        color: '#1398A4', textColor: '#ffffff' },
    { id: 'A',        label: 'A',         color: '#005E74', textColor: '#ffffff' },
    { id: 'BBB',      label: 'BBB',       color: '#91D479', textColor: '#18181b' },
    { id: 'BelowBBB', label: 'Below BBB', color: '#C4F4F8', textColor: '#18181b' },
    { id: 'NotRated', label: 'Not Rated', color: '#ADCCDA', textColor: '#18181b' },
    { id: 'Other',    label: 'Other',     color: '#F5DB95', textColor: '#18181b' },
  ];

  type SecurityTypeBucket = 'Government' | 'Municipal' | 'Corporate' | 'Securitized' | 'CashEq' | 'Derivative';
  const SECURITY_TYPE_BUCKETS: ReadonlyArray<{ id: SecurityTypeBucket; label: string; color: string; textColor: string }> = [
    { id: 'Government',  label: 'Government',        color: '#3d7d27', textColor: '#ffffff' },
    { id: 'Municipal',   label: 'Municipal',         color: '#1398A4', textColor: '#ffffff' },
    { id: 'Corporate',   label: 'Corporate',         color: '#005E74', textColor: '#ffffff' },
    { id: 'Securitized', label: 'Securitized',       color: '#91D479', textColor: '#18181b' },
    { id: 'CashEq',      label: 'Cash & Equivalent', color: '#C4F4F8', textColor: '#18181b' },
    { id: 'Derivative',  label: 'Derivative',        color: '#ADCCDA', textColor: '#18181b' },
  ];

  type MaturityBucket = 'M0_3' | 'M3_5' | 'M5_10' | 'M10_20' | 'M20Plus';
  const MATURITY_BUCKETS: ReadonlyArray<{ id: MaturityBucket; label: string; color: string; textColor: string }> = [
    { id: 'M0_3',    label: '0–3 yr',   color: '#3D7D27', textColor: '#ffffff' },
    { id: 'M3_5',    label: '3–5 yr',   color: '#1398A4', textColor: '#ffffff' },
    { id: 'M5_10',   label: '5–10 yr',  color: '#005E74', textColor: '#ffffff' },
    { id: 'M10_20', label: '10–20 yr', color: '#91D479', textColor: '#18181b' },
    { id: 'M20Plus', label: '20+ yr',   color: '#C4F4F8', textColor: '#18181b' },
  ];
  // creditWeight = % of fixed-income holdings in credit/corporate (i.e. non-Treasury,
  // non-agency). The bar's portfolio dots are placed by this value's delta vs the index.
  const FI_PORTFOLIO_DATA: Record<PortfolioName, {
    creditBreakdown: Record<CreditBucket, number>;
    securityType: Record<SecurityTypeBucket, number>;
    maturityBreakdown: Record<MaturityBucket, number>;
    creditSpreadBps: number;
    creditSpreadHistory: number[]; // 8 quarters, oldest → newest
    creditWeight: number;
    creditWeightHistory: number[]; // 8 quarters of credit allocation %, latest matches creditWeight
    avgEffDuration: number;  // years
    avgEffMaturity: number;  // years
    ytm: number;             // %, yield to maturity
    secYield: number;        // %, 30-day SEC yield
  }> = {
    'Avg. Client': {
      creditBreakdown: { AAA: 22, AA: 24, A: 26, BBB: 17, BelowBBB: 5, NotRated: 4, Other: 2 },
      securityType: { Government: 32, Municipal: 8, Corporate: 28, Securitized: 22, CashEq: 8, Derivative: 2 },
      maturityBreakdown: { M0_3: 22, M3_5: 24, M5_10: 30, M10_20: 14, M20Plus: 10 },
      creditSpreadBps: 92,
      creditSpreadHistory: [105, 100, 92, 98, 105, 84, 86, 99],
      creditWeight: 50,
      creditWeightHistory: [52, 51, 50, 50, 53, 51, 49, 50],
      avgEffDuration: 5.8,
      avgEffMaturity: 7.6,
      ytm: 4.65,
      secYield: 4.42,
    },
    'Core+ Model': {
      creditBreakdown: { AAA: 14, AA: 22, A: 28, BBB: 22, BelowBBB: 8, NotRated: 4, Other: 2 },
      securityType: { Government: 22, Municipal: 6, Corporate: 38, Securitized: 26, CashEq: 6, Derivative: 2 },
      maturityBreakdown: { M0_3: 18, M3_5: 22, M5_10: 32, M10_20: 16, M20Plus: 12 },
      creditSpreadBps: 115,
      creditSpreadHistory: [125, 120, 112, 118, 130, 105, 108, 122],
      creditWeight: 65,
      creditWeightHistory: [66, 65, 64, 64, 68, 65, 63, 65],
      avgEffDuration: 6.5,
      avgEffMaturity: 8.4,
      ytm: 4.95,
      secYield: 4.78,
    },
  };
  // Index credit spread = (Bloomberg US Credit yield) − (Bloomberg US Treasury yield).
  // Stored as a derived series (already-subtracted bps) so the slider/chart consume one
  // number per period rather than two raw OAS readings.
  const FI_INDEX = {
    creditBreakdownLabel: 'Bloomberg US Aggregate',
    securityTypeLabel: 'Bloomberg US Aggregate',
    maturityBreakdownLabel: 'Bloomberg US Aggregate',
    spreadLabel: 'Credit − Gov Index',
    creditBreakdown: { AAA: 68, AA: 4, A: 12, BBB: 13, BelowBBB: 0, NotRated: 2, Other: 1 } as Record<CreditBucket, number>,
    securityType: { Government: 42, Municipal: 1, Corporate: 27, Securitized: 28, CashEq: 2, Derivative: 0 } as Record<SecurityTypeBucket, number>,
    maturityBreakdown: { M0_3: 26, M3_5: 22, M5_10: 28, M10_20: 14, M20Plus: 10 } as Record<MaturityBucket, number>,
    spreadBps: 80,
    // Bloomberg US Credit OAS, quarter-ends Q2 2024 → Q1 2026. Q2 2025 reflects post-tariff
    // (April 2025) retracement from the ~121 intra-quarter peak; Q3 2025 = 74 was the
    // tightest reading since 1998; Q1 2026 = 89 was 11bps wider than the January low of ~71.
    spreadHistory: [95, 90, 82, 88, 95, 74, 76, 89],
    creditWeight: 30, // Bloomberg Aggregate is treasury/agency-heavy; ~30% sits in credit.
    avgEffDuration: 6.1,
    avgEffMaturity: 8.0,
    ytm: 4.55,
  };

  // US Treasury par yield curve plus Fed reverse-repo rate (RRP) at the front end —
  // current quarter-end (Q1 2026 = 03/31/2026) and the same quarter one year prior
  // (Q1 2025 = 03/31/2025). Treasury tenors source: Federal Reserve H.15 selected
  // interest rates. tenorYears feeds yield/duration interpolation; tenorLabels feeds
  // the x-axis tick labels. Yields in %.
  const FI_YIELD_CURVE = {
    tenorYears:  [0,    0.0833, 0.1667, 0.25, 0.3333, 0.5,  1.0,  2.0,  3.0,  5.0,  7.0,  10.0, 20.0, 30.0],
    tenorLabels: ['RRP','1M',   '2M',   '3M', '4M',   '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y','20Y','30Y'],
    current:     [3.65, 3.69,   3.70,   3.70, 3.70,   3.69, 3.68, 3.79, 3.81, 3.92, 4.11, 4.30, 4.88, 4.88],
    yearAgo:     [4.30, 4.34,   4.34,   4.32, 4.27,   4.20, 4.03, 3.89, 3.89, 3.96, 4.09, 4.23, 4.62, 4.59],
  };

  // Linear interpolation of a yield curve at a given duration (years). Clamps to the
  // ends of the tenor range when duration sits outside the sampled tenors.
  const interpolateYield = (curve: readonly number[], tenors: readonly number[], duration: number): number => {
    if (duration <= tenors[0]) return curve[0];
    if (duration >= tenors[tenors.length - 1]) return curve[curve.length - 1];
    for (let i = 0; i < tenors.length - 1; i++) {
      const a = tenors[i];
      const b = tenors[i + 1];
      if (duration >= a && duration <= b) {
        const t = (duration - a) / (b - a);
        return curve[i] + t * (curve[i + 1] - curve[i]);
      }
    }
    return curve[curve.length - 1];
  };

  // 10-year context for the Credit Spread bar — left edge = tenYearMin (Narrow),
  // right edge = tenYearMax (Wide), interior tick at tenYearAvg divides the gradient.
  const FI_SPREAD_CONTEXT = {
    tenYearMin: 70,
    tenYearAvg: 135,
    tenYearMax: 280,
  };

  // Toggle for the Credit Spread card: snapshot vs history.
  const [creditSpreadView, setCreditSpreadView] = useState<'slider' | 'chart'>('slider');

  // Slider-element animations (bar / dial / dots) sit inside row-stagger-4, so on initial
  // mount they correctly inherit the 3s row delay. After that initial cascade completes,
  // we want chart→slider toggles to animate immediately rather than re-triggering the long
  // delay. This flag flips once Row 4's stagger + a single data-pop run has elapsed; from
  // then on, elements pass an inline animationDelay of 0 to override the CSS rule.
  const [initialStaggerDone, setInitialStaggerDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setInitialStaggerDone(true), ROW_4_STAGGER_MS + 1500);
    return () => clearTimeout(t);
  }, []);

  // Quarter labels (oldest → newest) for the Credit Spread line chart x-axis.
  const creditSpreadQuarters = useMemo(() => [...quarterEndOptions].slice(0, 8).reverse(), [quarterEndOptions]);

  // recharts LineChart series data — one row per quarter. Portfolio columns hold credit
  // allocation % (so a rising line = portfolio tilting toward credit) and plot on the right
  // axis; the index column is the Credit − Treasury yield spread (bps) and plots on the
  // left axis. Different units → dual-axis chart.
  const creditSpreadSeries = useMemo(() => {
    return creditSpreadQuarters.map((q, i) => {
      const row: Record<string, string | number> = { period: q };
      PORTFOLIO_OPTIONS.forEach(name => {
        row[name] = FI_PORTFOLIO_DATA[name].creditWeightHistory[i];
      });
      row[FI_INDEX.spreadLabel] = FI_INDEX.spreadHistory[i];
      return row;
    });
    // FI mock objects are inline literals — stable per render, safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditSpreadQuarters]);

  // Snap a series of values to a domain rounded outward to the nearest 5, with evenly-
  // spaced ticks every 5 units. Empty input falls back to 0–100 / 25-step ticks.
  const snapAxisTo5 = (values: number[]): { domain: [number, number]; ticks: number[] } => {
    if (values.length === 0) return { domain: [0, 100], ticks: [0, 25, 50, 75, 100] };
    const min = Math.floor(Math.min(...values) / 5) * 5;
    const max = Math.ceil(Math.max(...values) / 5) * 5;
    const ticks: number[] = [];
    for (let v = min; v <= max; v += 5) ticks.push(v);
    return { domain: [min, max], ticks };
  };

  const bpsAxis = useMemo(
    () => snapAxisTo5(creditSpreadSeries.map(r => r[FI_INDEX.spreadLabel] as number)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [creditSpreadSeries],
  );

  const weightAxis = useMemo(
    () =>
      snapAxisTo5(
        displayedPortfolios
          .filter(p => !p.exiting)
          .flatMap(p => FI_PORTFOLIO_DATA[p.name].creditWeightHistory),
      ),
    // FI_PORTFOLIO_DATA is captured from the latest render; deps tracked via displayedPortfolios.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayedPortfolios],
  );

  // Spread bar axis: tenYearMin → tenYearMax. The bar visualizes where current spread
  // sits across the 10-year range, so positions are computed against that window rather
  // than a fixed scale. Out-of-range values (shouldn't happen with current mocks) clamp.
  const SPREAD_AXIS_MIN = FI_SPREAD_CONTEXT.tenYearMin;
  const SPREAD_AXIS_MAX = FI_SPREAD_CONTEXT.tenYearMax;
  const spreadBarPos = (bps: number) => {
    const pct = ((bps - SPREAD_AXIS_MIN) / (SPREAD_AXIS_MAX - SPREAD_AXIS_MIN)) * 100;
    return `${Math.min(100, Math.max(0, pct))}%`;
  };
  // Portfolio dots are positioned by credit overweight relative to the index, anchored
  // at the index dial position. 1pp overweight = 1pp of bar width offset.
  const indexBarPct =
    ((FI_INDEX.spreadBps - SPREAD_AXIS_MIN) / (SPREAD_AXIS_MAX - SPREAD_AXIS_MIN)) * 100;
  const tiltBarPos = (portfolioCreditWeight: number) => {
    const overweight = portfolioCreditWeight - FI_INDEX.creditWeight;
    const pct = indexBarPct + overweight;
    return `${Math.min(100, Math.max(0, pct))}%`;
  };

  // Row schema for the metrics-vs-index table. Each row pulls portfolio + index values
  // from the same data sources that drive the visual cards above, plus a formatter for
  // the cell value and the delta. `index: null` marks rows that have no benchmark
  // counterpart (e.g. SEC Yield) — the index cell renders an em-dash and delta cells
  // skip the comparison.
  type MetricRow = {
    id: string;
    label: string;
    // For some metrics a lower-than-index reading is the favorable direction (e.g. cheaper P/B,
    // less mega-cap concentration). Flip the green/red mapping on those rows so the color
    // reflects "good vs bad" rather than literal "above vs below".
    invertColor?: boolean;
    index: number | null;
    getPortfolio: (name: PortfolioName) => number;
    format: (v: number) => string;
    formatDelta: (v: number) => string;
  };
  const fmtPct2       = (v: number) => `${v.toFixed(2)}%`;
  const fmtPctDelta   = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
  const fmtPct2Delta  = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`;
  const fmtRatio      = (v: number) => v.toFixed(2);
  const fmtRatioDelta = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
  const fmtMktCap     = (v: number) => `$${v}B`;
  const fmtMktCapDel  = (v: number) => `${v >= 0 ? '+' : '−'}$${Math.abs(Math.round(v))}B`;
  const fmtCount      = (v: number) => v.toLocaleString();
  const fmtCountDelta = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString()}`;
  const fmtYears      = (v: number) => `${v.toFixed(1)} yrs`;
  const fmtYearsDelta = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} yrs`;
  const metricsTableRows: MetricRow[] = [
    {
      id: 'companies', label: '# of Companies',
      index: companyCounts.index,
      getPortfolio: (name) => companyCounts.portfolios[name],
      format: fmtCount, formatDelta: fmtCountDelta,
    },
    {
      id: 'mktCap', label: 'Wtd Avg Mkt Cap', invertColor: true,
      index: styleXY.benchmark.y,
      getPortfolio: (name) => styleXY.portfolios[name].y,
      format: fmtMktCap, formatDelta: fmtMktCapDel,
    },
    {
      id: 'pb', label: 'P/B', invertColor: true,
      index: styleXY.benchmark.x,
      getPortfolio: (name) => styleXY.portfolios[name].x,
      format: fmtRatio, formatDelta: fmtRatioDelta,
    },
    {
      id: 'profitability', label: 'Profitability',
      index: profitabilityXY.benchmark.y,
      getPortfolio: (name) => profitabilityXY.portfolios[name].y,
      format: fmtRatio, formatDelta: fmtRatioDelta,
    },
  ];

  // FI Metrics table rows — same shape as `metricsTableRows`, sourced from FI_PORTFOLIO_DATA
  // and FI_INDEX. SEC Yield has no index counterpart (`index: null`), so its index cell and
  // every delta cell on that row render an em-dash.
  const fiMetricsTableRows: MetricRow[] = [
    {
      id: 'duration', label: 'Avg Eff Duration',
      index: FI_INDEX.avgEffDuration,
      getPortfolio: (name) => FI_PORTFOLIO_DATA[name].avgEffDuration,
      format: fmtYears, formatDelta: fmtYearsDelta,
    },
    {
      id: 'maturity', label: 'Avg Eff Maturity',
      index: FI_INDEX.avgEffMaturity,
      getPortfolio: (name) => FI_PORTFOLIO_DATA[name].avgEffMaturity,
      format: fmtYears, formatDelta: fmtYearsDelta,
    },
    {
      id: 'ytm', label: 'YTM',
      index: FI_INDEX.ytm,
      getPortfolio: (name) => FI_PORTFOLIO_DATA[name].ytm,
      format: fmtPct2, formatDelta: fmtPct2Delta,
    },
    {
      id: 'secYield', label: 'SEC Yield',
      index: null,
      getPortfolio: (name) => FI_PORTFOLIO_DATA[name].secYield,
      format: fmtPct2, formatDelta: fmtPct2Delta,
    },
  ];

  // Tooltip state for chart dots (Style Map, Profitability Map)
  const [dotTooltip, setDotTooltip] = useState<{ label: string; lines: string[]; x: number; y: number } | null>(null);

  const dotHoverHandlers = (label: string, lines: string[]) => ({
    onMouseEnter: (e: React.MouseEvent) => setDotTooltip({ label, lines, x: e.clientX, y: e.clientY }),
    onMouseMove: (e: React.MouseEvent) => setDotTooltip(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev)),
    onMouseLeave: () => setDotTooltip(null),
  });

  // Style Box width scales with the card cell width via a container query: take the cell
  // width (100cqi), subtract the y-label strip + a little breathing room, then clamp.
  // Height stays fixed so the box visibly stretches horizontally on wider screens.
  const styleBoxWidth = 'clamp(200px, calc(100cqi - 56px), 480px)';
  const styleBoxHeight = '280px';

  const filteredPortfolios = useMemo(() => {
    // All filters are cosmetic for now — pass the "all" sentinels so dummy data
    // isn't filtered out when a user makes a selection.
    return filterPortfolios(loggedPortfolios, 'All Team Members', 'All Departments', 'ALL');
  }, []);

  const benchmarkComparison = useMemo(() => computeBenchmarkComparison(filteredPortfolios), [filteredPortfolios]);

  // Per-portfolio variants of the regional benchmark comparison. Avg. Client uses the
  // computed average; Core+ Model is a hardcoded mock variant that shares the same metric
  // ordering and ACWI baseline.
  const benchmarkComparisonByPortfolio = useMemo<Record<PortfolioName, BenchmarkComparison[]>>(() => {
    const acwiByMetric = benchmarkComparison.reduce<Record<string, number>>((acc, row) => {
      acc[row.metric] = row.acwi;
      return acc;
    }, {});
    const buildVariant = (clients: Record<string, number>): BenchmarkComparison[] =>
      benchmarkComparison.map(row => {
        const client = clients[row.metric] ?? row.client;
        const acwi = acwiByMetric[row.metric] ?? row.acwi;
        return { metric: row.metric, client, acwi, delta: Math.round((client - acwi) * 10) / 10 };
      });
    return {
      'Avg. Client': benchmarkComparison,
      'Core+ Model': buildVariant({ 'US Equity': 58, 'Intl Dev': 30, 'EM': 12 }),
    };
  }, [benchmarkComparison]);

  // Region/portfolio matrix the BenchmarkBarChart consumes. Always includes both portfolios
  // (the chart picks which to draw based on displayedPortfolios) so the data reference is
  // stable across selection changes.
  const benchmarkRegions = useMemo(() => {
    return benchmarkComparison.map((row, metricIdx) => ({
      region: row.metric,
      acwi: row.acwi,
      portfolios: PORTFOLIO_OPTIONS.reduce((acc, name) => {
        const p = benchmarkComparisonByPortfolio[name][metricIdx];
        acc[name] = { client: p.client, delta: p.delta };
        return acc;
      }, {} as Record<string, { client: number; delta: number }>),
    }));
  }, [benchmarkComparison, benchmarkComparisonByPortfolio]);

  const dataQualityStats = useMemo(() => {
    const total = filteredPortfolios.length;
    const totalPositions = filteredPortfolios.reduce((sum, p) => sum + p.positions.length, 0);
    const avgPositions = total ? Math.round(totalPositions / total) : 0;
    const uniqueClients = new Set(filteredPortfolios.map(p => p.internalClient.name)).size;

    const equityCount = filteredPortfolios.filter(p => {
      const c = p.characteristics;
      return (c.usEquityAllocation + c.devExUsAllocation + c.emAllocation) >= 50;
    }).length;
    const fiCount = total - equityCount;

    const now = Date.now();
    const recent30 = filteredPortfolios.filter(p => {
      const days = (now - new Date(p.loggedAt).getTime()) / (1000 * 60 * 60 * 24);
      return days <= 30;
    }).length;
    const recentPct = total ? Math.round((recent30 / total) * 100) : 0;

    return [
      { label: 'Unique Clients', value: uniqueClients.toLocaleString() },
      { label: 'Portfolios Logged', value: total.toLocaleString() },
      { label: 'Equity Portfolios', value: equityCount.toLocaleString() },
      { label: 'F.I. Portfolios', value: fiCount.toLocaleString() },
      { label: 'Avg Positions', value: avgPositions.toLocaleString() },
      { label: 'Recent Updates', value: `${recentPct}%` },
    ];
  }, [filteredPortfolios]);

  return (
    <>
        {/* Top Bar with Filters */}
        <DashboardHeader
          title="Portfolio Trends"
          subtitle="Portfolio construction insights and client analytics"
          searchPlaceholder=""
          searchValue=""
          onSearchChange={() => {}}
          filters={[
            {
              id: 'team',
              icon: Users,
              label: 'Teams',
              options: ['All Teams', ...TEAMS],
              value: teamFilter,
              onChange: (v: string | string[]) => setTeamFilter(v as string),
            },
            {
              id: 'department',
              icon: Building2,
              label: 'Department',
              options: ['All Departments', ...DEPARTMENTS],
              value: departmentFilter,
              onChange: (v: string | string[]) => setDepartmentFilter(v as string[]),
              multiSelect: true,
            },
            {
              id: 'assetClass',
              isActive: equityScope !== 'Total' || !fixedIncomeOn,
              signature: `${equityScope ?? 'none'}|${fixedIncomeOn ? '1' : '0'}`,
              render: () => (
                <AssetClassFilterButton
                  equity={equityScope}
                  fixedIncome={fixedIncomeOn}
                  onEquityChange={setEquityScope}
                  onFixedIncomeChange={setFixedIncomeOn}
                />
              ),
            },
            {
              id: 'portfolios',
              icon: Layers,
              label: 'Portfolios',
              options: [...PORTFOLIO_OPTIONS],
              value: portfolioFilter,
              onChange: (v: string | string[]) => setPortfolioFilter(v as string[]),
              multiSelect: true,
              noAllOption: true,
            },
          ]}
          period={period}
          onPeriodChange={setPeriod}
          periodOptions={quarterEndOptions}
          className="sticky top-0 z-10"
          alwaysShowFilters
        />

        <div className="p-6 space-y-6">
          {/* Data Strip */}
          <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800/50 px-5 py-3 rounded-xl">
            <div
              className="grid items-center gap-4"
              style={{ gridTemplateColumns: `10% repeat(${dataQualityStats.length}, minmax(0, 1fr))` }}
            >
              <span className="text-[10px] uppercase tracking-wider text-muted font-medium">
                Data Metrics
              </span>
              {dataQualityStats.map((s) => (
                <div key={s.label} className="flex items-baseline justify-center gap-2 min-w-0">
                  <span className="text-sm font-mono font-semibold text-zinc-200 flex-shrink-0">{s.value}</span>
                  <span className="text-[11px] text-muted truncate">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ==================== SECTION 1: PORTFOLIO CONSTRUCTION ==================== */}
          {equityVisibility !== 'hidden' && (
          <div className={equityVisibility === 'exiting' ? 'section-exit' : undefined}>
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-white">{titleEquityScope} Equity Portfolio Trends</h3>
              <span className="text-xs text-muted ml-2">Style, quality, and regional positioning vs benchmark</span>
            </div>

            {/* Charts Row 1: Style XY + Profitability XY + Metrics vs Index */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              {/* Style Map - Market Cap vs P/B */}
              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl flex flex-col min-h-[340px]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Style XY</h4>
                      <p className="text-xs text-muted">vs MSCI ACWI IMI ({period})</p>
                    </div>
                  </div>

                  <div className="flex flex-1 min-h-[140px]">
                    <div className="flex items-center justify-center mr-1" style={{ width: '20px' }}>
                      <span className="-rotate-90 text-xs text-muted whitespace-nowrap">Wtd Avg Mkt Cap ($B)</span>
                    </div>

                    <div className="flex-1 flex flex-col">
                      <div className="flex flex-1">
                        <div className="flex flex-col justify-between text-right pr-2" style={{ width: '28px' }}>
                          <span className="text-xs text-muted">600</span>
                          <span className="text-xs text-muted">400</span>
                          <span className="text-xs text-muted">200</span>
                        </div>

                        <div className="flex-1 relative border-l border-b border-zinc-700/50 overflow-hidden">
                          <div className="data-pop absolute left-0 right-0 border-t border-zinc-500/50" style={{ top: pct(styleXY.benchmark.y, styleXY.y.min, styleXY.y.max, true) }} />
                          <div className="data-pop absolute top-0 bottom-0 border-l border-zinc-500/50" style={{ left: pct(styleXY.benchmark.x, styleXY.x.min, styleXY.x.max) }} />
                          <div
                            className="data-pop absolute w-4 h-4 rounded-full bg-zinc-500 border-2 border-zinc-400 z-10 cursor-pointer"
                            style={{
                              left: pct(styleXY.benchmark.x, styleXY.x.min, styleXY.x.max),
                              top: pct(styleXY.benchmark.y, styleXY.y.min, styleXY.y.max, true),
                              transform: 'translate(-50%, -50%)',
                            }}
                            {...dotHoverHandlers(styleXY.benchmark.name, [
                              `Mkt Cap: ${styleXY.y.format(styleXY.benchmark.y)}`,
                              `P/B: ${styleXY.x.format(styleXY.benchmark.x)}`,
                            ])}
                          />
                          {displayedPortfolios.map(({ name, idx, exiting }) => {
                            const point = styleXY.portfolios[name];
                            const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                            return (
                              <div
                                key={name}
                                className={`${exiting ? 'data-fade' : 'data-pop'} absolute w-4 h-4 rounded-full border-2 z-10 cursor-pointer`}
                                style={{
                                  left: pct(point.x, styleXY.x.min, styleXY.x.max),
                                  top: pct(point.y, styleXY.y.min, styleXY.y.max, true),
                                  transform: 'translate(-50%, -50%)',
                                  backgroundColor: color.hex,
                                  borderColor: color.hex,
                                  boxShadow: `0 0 14px ${color.glow}`,
                                }}
                                {...dotHoverHandlers(name, [
                                  `Mkt Cap: ${styleXY.y.format(point.y)}`,
                                  `P/B: ${styleXY.x.format(point.x)}`,
                                ])}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex justify-between pl-7 pr-0 mt-1">
                        <span className="text-xs text-muted">2.0</span>
                        <span className="text-xs text-muted">3.0</span>
                        <span className="text-xs text-muted">4.0</span>
                      </div>

                      <div className="text-center mt-1">
                        <span className="text-xs text-muted">Wtd Avg P/B</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center flex-wrap gap-x-6 gap-y-2 mt-3">
                    {displayedPortfolios.map(({ name, idx, exiting }) => {
                      const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                      return (
                        <div key={name} className={`flex items-center gap-2 ${exiting ? 'data-fade' : ''}`}>
                          <div
                            className="w-3 h-3 rounded-full border"
                            style={{ backgroundColor: color.hex, borderColor: color.hex }}
                          />
                          <span className="text-xs text-muted">{name}</span>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-zinc-500 border border-zinc-400" />
                      <span className="text-xs text-muted">MSCI ACWI IMI</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Profitability Map */}
              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl flex flex-col min-h-[340px]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Profitability XY</h4>
                      <p className="text-xs text-muted">vs MSCI ACWI IMI ({period})</p>
                    </div>
                  </div>

                  <div className="flex flex-1 min-h-[140px]">
                    <div className="flex items-center justify-center mr-1" style={{ width: '20px' }}>
                      <span className="-rotate-90 text-xs text-muted whitespace-nowrap">Wtd Avg Profitability</span>
                    </div>

                    <div className="flex-1 flex flex-col">
                      <div className="flex flex-1">
                        <div className="flex flex-col justify-between text-right pr-2" style={{ width: '28px' }}>
                          <span className="text-xs text-muted">.60</span>
                          <span className="text-xs text-muted">.45</span>
                          <span className="text-xs text-muted">.30</span>
                        </div>

                        <div className="flex-1 relative border-l border-b border-zinc-700/50 overflow-hidden">
                          <div className="data-pop absolute left-0 right-0 border-t border-zinc-500/50" style={{ top: pct(profitabilityXY.benchmark.y, profitabilityXY.y.min, profitabilityXY.y.max, true) }} />
                          <div className="data-pop absolute top-0 bottom-0 border-l border-zinc-500/50" style={{ left: pct(profitabilityXY.benchmark.x, profitabilityXY.x.min, profitabilityXY.x.max) }} />
                          <div
                            className="data-pop absolute w-4 h-4 rounded-full bg-zinc-500 border-2 border-zinc-400 z-10 cursor-pointer"
                            style={{
                              left: pct(profitabilityXY.benchmark.x, profitabilityXY.x.min, profitabilityXY.x.max),
                              top: pct(profitabilityXY.benchmark.y, profitabilityXY.y.min, profitabilityXY.y.max, true),
                              transform: 'translate(-50%, -50%)',
                            }}
                            {...dotHoverHandlers(profitabilityXY.benchmark.name, [
                              `Profitability: ${profitabilityXY.y.format(profitabilityXY.benchmark.y)}`,
                              `P/B: ${profitabilityXY.x.format(profitabilityXY.benchmark.x)}`,
                            ])}
                          />
                          {displayedPortfolios.map(({ name, idx, exiting }) => {
                            const point = profitabilityXY.portfolios[name];
                            const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                            return (
                              <div
                                key={name}
                                className={`${exiting ? 'data-fade' : 'data-pop'} absolute w-4 h-4 rounded-full border-2 z-10 cursor-pointer`}
                                style={{
                                  left: pct(point.x, profitabilityXY.x.min, profitabilityXY.x.max),
                                  top: pct(point.y, profitabilityXY.y.min, profitabilityXY.y.max, true),
                                  transform: 'translate(-50%, -50%)',
                                  backgroundColor: color.hex,
                                  borderColor: color.hex,
                                  boxShadow: `0 0 14px ${color.glow}`,
                                }}
                                {...dotHoverHandlers(name, [
                                  `Profitability: ${profitabilityXY.y.format(point.y)}`,
                                  `P/B: ${profitabilityXY.x.format(point.x)}`,
                                ])}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex justify-between pl-7 pr-0 mt-1">
                        <span className="text-xs text-muted">2.0</span>
                        <span className="text-xs text-muted">3.0</span>
                        <span className="text-xs text-muted">4.0</span>
                      </div>

                      <div className="text-center mt-1">
                        <span className="text-xs text-muted">Wtd Avg P/B</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-center flex-wrap gap-x-6 gap-y-2 mt-3">
                    {displayedPortfolios.map(({ name, idx, exiting }) => {
                      const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                      return (
                        <div key={name} className={`flex items-center gap-2 ${exiting ? 'data-fade' : ''}`}>
                          <div
                            className="w-3 h-3 rounded-full border"
                            style={{ backgroundColor: color.hex, borderColor: color.hex }}
                          />
                          <span className="text-xs text-muted">{name}</span>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-zinc-500 border border-zinc-400" />
                      <span className="text-xs text-muted">MSCI ACWI IMI</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Metrics vs Index */}
              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl min-h-[340px] flex flex-col">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Metrics vs Index</h4>
                      <p className="text-xs text-muted">vs MSCI ACWI IMI ({period})</p>
                    </div>
                  </div>

                  <table className="w-full text-xs">
                    <thead>
                      <tr className="data-pop border-b border-zinc-700/60">
                        <th className="text-left font-normal py-1.5 pr-2 text-muted">Metric</th>
                        {visiblePortfolios.map(({ name, idx, exiting }) => {
                          const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                          return (
                            <th key={name} className="text-right font-medium py-1.5 px-0">
                              <span className={exiting ? 'col-collapse' : 'col-expand'} style={{ color: color.hex }}>
                                {name}
                              </span>
                            </th>
                          );
                        })}
                        <th className="text-right font-medium py-1.5 pl-2" style={{ color: '#a1a1aa' }}>
                          Index
                        </th>
                        {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                          const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                          return (
                            <th key={`${name}-delta`} className="text-right font-medium py-1.5 px-0">
                              <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'} style={{ color: color.hex }}>
                                Δ
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {metricsTableRows.map((row, rowIdx) => (
                        <tr
                          key={row.id}
                          className="data-pop border-b border-zinc-800/40 last:border-b-0"
                          style={{ animationDelay: `${80 + rowIdx * 120}ms` }}
                        >
                          <td className="py-1.5 pr-2 text-white font-medium">
                            {row.label}
                          </td>
                          {visiblePortfolios.map(({ name, exiting }) => (
                            <td
                              key={name}
                              className="text-right font-mono tabular-nums py-1.5 px-0 text-white font-medium"
                            >
                              <span className={exiting ? 'col-collapse' : 'col-expand'}>
                                {row.format(row.getPortfolio(name))}
                              </span>
                            </td>
                          ))}
                          <td className="text-right font-mono tabular-nums py-1.5 pl-2 text-white font-medium">
                            {row.index === null ? '—' : row.format(row.index)}
                          </td>
                          {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                            const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                            if (row.index === null) {
                              return (
                                <td
                                  key={`${name}-delta`}
                                  className="text-right font-mono tabular-nums py-1.5 px-0 text-muted"
                                >
                                  <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'}>—</span>
                                </td>
                              );
                            }
                            const delta = row.getPortfolio(name) - row.index;
                            const positive = delta > 0;
                            const zero = delta === 0;
                            // Triangle stays portfolio-colored; the number itself goes green/red.
                            // For inverted rows (e.g. P/B, Large Cap), being below the index is
                            // the favorable direction so green/red are flipped.
                            const favorable = row.invertColor ? !positive : positive;
                            const valueColor = zero ? '#a1a1aa' : favorable ? '#4ade80' : '#f87171';
                            return (
                              <td
                                key={`${name}-delta`}
                                className="text-right font-mono tabular-nums py-1.5 px-0"
                              >
                                <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'}>
                                  <span className="inline-flex items-center justify-end gap-1">
                                    <span style={{ fontSize: '8px', lineHeight: 1, color: zero ? '#a1a1aa' : color.hex }}>
                                      {zero ? '—' : positive ? '▲' : '▼'}
                                    </span>
                                    <span style={{ color: valueColor }}>
                                      {zero ? '0' : row.formatDelta(delta)}
                                    </span>
                                  </span>
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Charts Row 2: vs MSCI ACWI IMI + Style x Profitability */}
            <div className="grid grid-cols-3 gap-4 mb-4 row-stagger-2">
              {/* Benchmark Comparison */}
              <div className="col-span-1 relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl min-h-[380px] flex flex-col">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">vs MSCI ACWI IMI</h4>
                      <p className="text-xs text-muted">Regional delta to benchmark ({period})</p>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col">
                    <div className="flex-1 min-h-[200px]">
                      <BenchmarkBarChart
                        data={benchmarkRegions}
                        displayedPortfolios={displayedPortfolios}
                        palette={PORTFOLIO_PALETTE}
                        staggerDelayMs={ROW_2_STAGGER_MS}
                      />
                    </div>

                    <div className="flex items-center justify-center flex-wrap gap-x-6 gap-y-2 mt-3">
                      {displayedPortfolios.map(({ name, idx, exiting }) => {
                        const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                        return (
                          <div key={name} className={`flex items-center gap-2 ${exiting ? 'data-fade' : ''}`}>
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color.hex }} />
                            <span className="text-xs text-muted">{name}</span>
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm bg-zinc-500/70" />
                        <span className="text-xs text-muted">MSCI ACWI IMI</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Style x Profitability — Morningstar Style Box + allocation table */}
              <div className="col-span-2 relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl min-h-[380px] flex flex-col">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Style × Profitability</h4>
                      <p className="text-xs text-muted">Allocation breakdown ({period})</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 flex-1 min-h-[220px]">
                    {/* Morningstar Style Box — 3×3 grid. Y is driven by Large/Mid/Small cap
                        weights (Large=top, Small=bottom); X is driven by Growth-vs-Value
                        weights (Value=left, Growth=right). The Core column is purely visual:
                        a balanced Growth/Value mix lands there naturally. */}
                    <div className="relative flex items-center justify-center" style={{ containerType: 'inline-size' }}>
                      <div className="flex flex-col items-start">
                        <div className="flex">
                          <div className="flex flex-col justify-around text-right pr-2" style={{ width: '40px', height: styleBoxHeight, maxHeight: '100%' }}>
                            <span className="text-xs text-muted leading-none">Large</span>
                            <span className="text-xs text-muted leading-none">Mid</span>
                            <span className="text-xs text-muted leading-none">Small</span>
                          </div>
                          <div className="relative border-4 border-zinc-600/80 rounded-sm" style={{ width: styleBoxWidth, height: styleBoxHeight, maxWidth: '100%', maxHeight: '100%' }}>
                            <div className="data-pop absolute left-0 right-0 border-t-[3px] border-zinc-700/70" style={{ top: '33.333%' }} />
                            <div className="data-pop absolute left-0 right-0 border-t-[3px] border-zinc-700/70" style={{ top: '66.667%' }} />
                            <div className="data-pop absolute top-0 bottom-0 border-l-[3px] border-zinc-700/70" style={{ left: '33.333%' }} />
                            <div className="data-pop absolute top-0 bottom-0 border-l-[3px] border-zinc-700/70" style={{ left: '66.667%' }} />

                            {/* Index dot — drawn first so portfolio dots layer on top */}
                            {(() => {
                              const cap = capAllocation.index;
                              const sty = styleProfitability.index;
                              const x = (sty['Growth High-Prof'] + sty['Growth Low-Prof']) / 100;
                              const y = (cap['Mid Cap'] * 0.5 + cap['Small Cap']) / 100;
                              const growthPct = Math.round(x * 100);
                              return (
                                <div
                                  className="data-pop absolute w-4 h-4 rounded-full bg-zinc-500 border-2 border-zinc-400 z-10 cursor-pointer"
                                  style={{
                                    left: `${x * 100}%`,
                                    top: `${y * 100}%`,
                                    transform: 'translate(-50%, -50%)',
                                  }}
                                  {...dotHoverHandlers('MSCI ACWI IMI', [
                                    `Large/Mid/Small: ${cap['Large Cap']}/${cap['Mid Cap']}/${cap['Small Cap']}%`,
                                    `Growth/Value: ${growthPct}/${100 - growthPct}%`,
                                  ])}
                                />
                              );
                            })()}

                            {displayedPortfolios.map(({ name, idx, exiting }) => {
                              const cap = capAllocation.portfolios[name];
                              const sty = styleProfitability.portfolios[name];
                              const x = (sty['Growth High-Prof'] + sty['Growth Low-Prof']) / 100;
                              const y = (cap['Mid Cap'] * 0.5 + cap['Small Cap']) / 100;
                              const growthPct = Math.round(x * 100);
                              const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                              return (
                                <div
                                  key={name}
                                  className={`${exiting ? 'data-fade' : 'data-pop'} absolute w-4 h-4 rounded-full border-2 z-10 cursor-pointer`}
                                  style={{
                                    left: `${x * 100}%`,
                                    top: `${y * 100}%`,
                                    transform: 'translate(-50%, -50%)',
                                    backgroundColor: color.hex,
                                    borderColor: color.hex,
                                    boxShadow: `0 0 14px ${color.glow}`,
                                  }}
                                  {...dotHoverHandlers(name, [
                                    `Large/Mid/Small: ${cap['Large Cap']}/${cap['Mid Cap']}/${cap['Small Cap']}%`,
                                    `Growth/Value: ${growthPct}/${100 - growthPct}%`,
                                  ])}
                                />
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex mt-1" style={{ width: styleBoxWidth, maxWidth: 'calc(100% - 40px)', marginLeft: '40px' }}>
                          <span className="flex-1 text-center text-xs text-muted leading-none">Value</span>
                          <span className="flex-1 text-center text-xs text-muted leading-none">Core</span>
                          <span className="flex-1 text-center text-xs text-muted leading-none">Growth</span>
                        </div>
                      </div>
                    </div>

                    {/* Allocation table — fills the cell so its row heights match the style box on the left */}
                    <div className="h-full w-full flex flex-col">
                      <table className="w-full h-full text-xs">
                        <thead>
                          <tr className="data-pop border-b border-zinc-700/60">
                            <th className="text-left font-normal py-1.5 pr-2 text-muted">Category</th>
                            {visiblePortfolios.map(({ name, idx, exiting }) => {
                              const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                              return (
                                <th key={name} className="text-right font-medium py-1.5 px-0">
                                  <span className={exiting ? 'col-collapse' : 'col-expand'} style={{ color: color.hex }}>
                                    {name}
                                  </span>
                                </th>
                              );
                            })}
                            <th className="text-right font-medium py-1.5 pl-2" style={{ color: '#a1a1aa' }}>
                              Index
                            </th>
                            {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                              const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                              return (
                                <th key={`${name}-delta`} className="text-right font-medium py-1.5 px-0">
                                  <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'} style={{ color: color.hex }}>
                                    Δ
                                  </span>
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {CAP_BUCKETS.map((bucket, capRowIdx) => {
                            const indexVal = capAllocation.index[bucket];
                            // Large Cap is inverted (less mega-cap concentration is favorable);
                            // Mid/Small Cap follow the literal above-index = green direction.
                            const invert = bucket === 'Large Cap';
                            return (
                              <tr
                                key={`cap-${bucket}`}
                                className="data-pop border-b border-zinc-800/40"
                                style={{ animationDelay: `${ROW_2_STAGGER_MS + 80 + capRowIdx * 120}ms` }}
                              >
                                <td className="py-1.5 pr-2 text-white font-medium">{bucket}</td>
                                {visiblePortfolios.map(({ name, exiting }) => (
                                  <td key={name} className="text-right font-mono tabular-nums py-1.5 px-0 text-white font-medium">
                                    <span className={exiting ? 'col-collapse' : 'col-expand'}>
                                      {capAllocation.portfolios[name][bucket]}%
                                    </span>
                                  </td>
                                ))}
                                <td className="text-right font-mono tabular-nums py-1.5 pl-2 text-white font-medium">
                                  {indexVal}%
                                </td>
                                {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                                  const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                                  const delta = capAllocation.portfolios[name][bucket] - indexVal;
                                  const positive = delta > 0;
                                  const zero = delta === 0;
                                  const favorable = invert ? !positive : positive;
                                  const valueColor = zero ? '#a1a1aa' : favorable ? '#4ade80' : '#f87171';
                                  return (
                                    <td key={`${name}-delta`} className="text-right font-mono tabular-nums py-1.5 px-0">
                                      <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'}>
                                        <span className="inline-flex items-center justify-end gap-1">
                                          <span style={{ fontSize: '8px', lineHeight: 1, color: zero ? '#a1a1aa' : color.hex }}>
                                            {zero ? '—' : positive ? '▲' : '▼'}
                                          </span>
                                          <span style={{ color: valueColor }}>
                                            {zero ? '0' : fmtPctDelta(delta)}
                                          </span>
                                        </span>
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                          {([
                            { total: 'Growth' as const, subs: ['Growth High-Prof', 'Growth Low-Prof'] as const, invert: true },
                            { total: 'Value' as const,  subs: ['Value High-Prof',  'Value Low-Prof']  as const, invert: false },
                          ]).map((group, groupIdxN) => {
                            const groupIdx = styleProfitability.index[group.subs[0]] + styleProfitability.index[group.subs[1]];
                            // Flat row index across both groups + the 3 leading cap rows, for the
                            // staggered entrance: caps 0-2, group 0 → 3,4,5; group 1 → 6,7,8.
                            // Same 80ms + 120ms·n formula as the Metrics vs Index card.
                            const totalRowIdx = 3 + groupIdxN * 3;
                            return (
                            <React.Fragment key={group.total}>
                              <tr
                                className="data-pop border-b border-zinc-800/40"
                                style={{ animationDelay: `${ROW_2_STAGGER_MS + 80 + totalRowIdx * 120}ms` }}
                              >
                                <td className="py-1.5 pr-2 text-white font-medium">{group.total}</td>
                                {visiblePortfolios.map(({ name, exiting }) => {
                                  const a = styleProfitability.portfolios[name];
                                  return (
                                    <td key={name} className="text-right font-mono tabular-nums py-1.5 px-0 text-white font-medium">
                                      <span className={exiting ? 'col-collapse' : 'col-expand'}>
                                        {a[group.subs[0]] + a[group.subs[1]]}%
                                      </span>
                                    </td>
                                  );
                                })}
                                <td className="text-right font-mono tabular-nums py-1.5 pl-2 text-white font-medium">
                                  {groupIdx}%
                                </td>
                                {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                                  const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                                  const a = styleProfitability.portfolios[name];
                                  const delta = (a[group.subs[0]] + a[group.subs[1]]) - groupIdx;
                                  const positive = delta > 0;
                                  const zero = delta === 0;
                                  const favorable = group.invert ? !positive : positive;
                                  const valueColor = zero ? '#a1a1aa' : favorable ? '#4ade80' : '#f87171';
                                  return (
                                    <td key={`${name}-delta`} className="text-right font-mono tabular-nums py-1.5 px-0">
                                      <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'}>
                                        <span className="inline-flex items-center justify-end gap-1">
                                          <span style={{ fontSize: '8px', lineHeight: 1, color: zero ? '#a1a1aa' : color.hex }}>
                                            {zero ? '—' : positive ? '▲' : '▼'}
                                          </span>
                                          <span style={{ color: valueColor }}>
                                            {zero ? '0' : fmtPctDelta(delta)}
                                          </span>
                                        </span>
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                              {group.subs.map((cat, subIdx) => {
                                // Growth Low-Prof is the only sub-row that gets inverted coloring (matches the metrics-vs-index card).
                                const subInvert = cat === 'Growth Low-Prof';
                                const subRowIdx = totalRowIdx + 1 + subIdx;
                                return (
                                <tr
                                  key={cat}
                                  className="data-pop border-b border-zinc-800/40 last:border-b-0"
                                  style={{ animationDelay: `${ROW_2_STAGGER_MS + 80 + subRowIdx * 120}ms` }}
                                >
                                  <td className="py-1.5 pl-4 pr-2 text-muted">{cat}</td>
                                  {visiblePortfolios.map(({ name, exiting }) => (
                                    <td key={name} className="text-right font-mono tabular-nums py-1.5 px-0 text-muted">
                                      <span className={exiting ? 'col-collapse' : 'col-expand'}>
                                        {styleProfitability.portfolios[name][cat]}%
                                      </span>
                                    </td>
                                  ))}
                                  <td className="text-right font-mono tabular-nums py-1.5 pl-2 text-muted">
                                    {styleProfitability.index[cat]}%
                                  </td>
                                  {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                                    const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                                    const delta = styleProfitability.portfolios[name][cat] - styleProfitability.index[cat];
                                    const positive = delta > 0;
                                    const zero = delta === 0;
                                    const favorable = subInvert ? !positive : positive;
                                    const valueColor = zero ? '#a1a1aa' : favorable ? '#4ade80' : '#f87171';
                                    return (
                                      <td key={`${name}-delta`} className="text-right font-mono tabular-nums py-1.5 px-0">
                                        <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'}>
                                          <span className="inline-flex items-center justify-end gap-1">
                                            <span style={{ fontSize: '8px', lineHeight: 1, color: zero ? '#a1a1aa' : color.hex }}>
                                              {zero ? '—' : positive ? '▲' : '▼'}
                                            </span>
                                            <span style={{ color: valueColor }}>
                                              {zero ? '0' : fmtPctDelta(delta)}
                                            </span>
                                          </span>
                                        </span>
                                      </td>
                                    );
                                  })}
                                </tr>
                                );
                              })}
                            </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
          )}

          {/* ==================== SECTION 2: FIXED INCOME ==================== */}
          {fixedIncomeVisibility !== 'hidden' && (
          <div className={fixedIncomeVisibility === 'exiting' ? 'section-exit' : undefined}>
            <div className="flex items-center gap-2 mb-4">
              <Landmark className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-white">Fixed Income</h3>
              <span className="text-xs text-muted ml-2">Duration, credit, and sector positioning vs benchmark</span>
            </div>

            {/* FI Row 1: FI Metrics (col-span-1) + Yield Curve (col-span-2) */}
            <div className="grid grid-cols-3 gap-4 mb-4 row-stagger-3">
              {/* FI Metrics — duration/maturity/yield table vs Bloomberg US Aggregate */}
              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl min-h-[340px] flex flex-col">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">FI Metrics</h4>
                      <p className="text-xs text-muted">vs {FI_INDEX.creditBreakdownLabel} ({period})</p>
                    </div>
                  </div>

                  <table className="w-full text-xs">
                    <thead>
                      <tr className="data-pop border-b border-zinc-700/60">
                        <th className="text-left font-normal py-1.5 pr-2 text-muted">Metric</th>
                        {visiblePortfolios.map(({ name, idx, exiting }) => {
                          const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                          return (
                            <th key={name} className="text-right font-medium py-1.5 px-0">
                              <span className={exiting ? 'col-collapse' : 'col-expand'} style={{ color: color.hex }}>
                                {name}
                              </span>
                            </th>
                          );
                        })}
                        <th className="text-right font-medium py-1.5 pl-2" style={{ color: '#a1a1aa' }}>
                          Index
                        </th>
                        {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                          const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                          return (
                            <th key={`${name}-delta`} className="text-right font-medium py-1.5 px-0">
                              <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'} style={{ color: color.hex }}>
                                Δ
                              </span>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {fiMetricsTableRows.map((row, rowIdx) => (
                        <tr
                          key={row.id}
                          className="data-pop border-b border-zinc-800/40 last:border-b-0"
                          style={{ animationDelay: `${ROW_3_STAGGER_MS + 80 + rowIdx * 120}ms` }}
                        >
                          <td className="py-1.5 pr-2 text-white font-medium">
                            {row.label}
                          </td>
                          {visiblePortfolios.map(({ name, exiting }) => (
                            <td
                              key={name}
                              className="text-right font-mono tabular-nums py-1.5 px-0 text-white font-medium"
                            >
                              <span className={exiting ? 'col-collapse' : 'col-expand'}>
                                {row.format(row.getPortfolio(name))}
                              </span>
                            </td>
                          ))}
                          <td className="text-right font-mono tabular-nums py-1.5 pl-2 text-white font-medium">
                            {row.index === null ? '—' : row.format(row.index)}
                          </td>
                          {deltaState !== 'hidden' && visiblePortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                            const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                            if (row.index === null) {
                              return (
                                <td
                                  key={`${name}-delta`}
                                  className="text-right font-mono tabular-nums py-1.5 px-0 text-muted"
                                >
                                  <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'}>—</span>
                                </td>
                              );
                            }
                            const delta = row.getPortfolio(name) - row.index;
                            const positive = delta > 0;
                            const zero = delta === 0;
                            const favorable = row.invertColor ? !positive : positive;
                            const valueColor = zero ? '#a1a1aa' : favorable ? '#4ade80' : '#f87171';
                            return (
                              <td
                                key={`${name}-delta`}
                                className="text-right font-mono tabular-nums py-1.5 px-0"
                              >
                                <span className={deltaState === 'exiting' ? 'col-collapse' : 'col-expand'}>
                                  <span className="inline-flex items-center justify-end gap-1">
                                    <span style={{ fontSize: '8px', lineHeight: 1, color: zero ? '#a1a1aa' : color.hex }}>
                                      {zero ? '—' : positive ? '▲' : '▼'}
                                    </span>
                                    <span style={{ color: valueColor }}>
                                      {zero ? '0' : row.formatDelta(delta)}
                                    </span>
                                  </span>
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Yield Curve — US Treasury, current quarter vs one year ago,
                  with each portfolio + index dotted at their avg eff duration. */}
              <div className="col-span-2 relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl flex flex-col min-h-[340px]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Yield Curve</h4>
                      <p className="text-xs text-muted">US Treasury — current vs 1 year ago ({period})</p>
                    </div>
                  </div>

                  {(() => {
                    const Y_MIN = 3.5;
                    const Y_MAX = 5.0;
                    const tenorYearsVisible = FI_YIELD_CURVE.tenorYears;
                    const tenorLabelsVisible = FI_YIELD_CURVE.tenorLabels;
                    const currentVisible = FI_YIELD_CURVE.current;
                    const yearAgoVisible = FI_YIELD_CURVE.yearAgo;
                    const n = tenorYearsVisible.length;
                    // Ordinal x-axis: each tenor sits at the center of its slot. Pairs with
                    // `justify-around` on the label row so labels align with their slot centers.
                    const slotX = (i: number) => ((i + 0.5) / n) * 100;
                    // Maps a duration in years to its x-position by finding the segment it
                    // falls within and interpolating between adjacent tenor slot centers.
                    const indexX = (duration: number): string => {
                      if (duration <= tenorYearsVisible[0]) return `${slotX(0).toFixed(2)}%`;
                      if (duration >= tenorYearsVisible[n - 1]) return `${slotX(n - 1).toFixed(2)}%`;
                      for (let i = 0; i < n - 1; i++) {
                        const a = tenorYearsVisible[i];
                        const b = tenorYearsVisible[i + 1];
                        if (duration >= a && duration <= b) {
                          const t = (duration - a) / (b - a);
                          return `${(slotX(i) + t * (slotX(i + 1) - slotX(i))).toFixed(2)}%`;
                        }
                      }
                      return `${slotX(n - 1).toFixed(2)}%`;
                    };
                    // Smooths the curve through every tenor point using a Catmull-Rom spline
                    // converted to cubic Béziers (tension factor 1/6). Each segment's tangent is
                    // derived from the slopes between its neighbors, so the path passes through
                    // every data point with rounded transitions instead of sharp corners.
                    const toSmoothPath = (curve: readonly number[]) => {
                      const pts = curve.map((v, i) => ({
                        x: slotX(i),
                        y: (1 - (v - Y_MIN) / (Y_MAX - Y_MIN)) * 100,
                      }));
                      if (pts.length === 0) return '';
                      if (pts.length === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
                      let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
                      for (let i = 0; i < pts.length - 1; i++) {
                        const p0 = pts[i - 1] ?? pts[i];
                        const p1 = pts[i];
                        const p2 = pts[i + 1];
                        const p3 = pts[i + 2] ?? pts[i + 1];
                        const cp1x = p1.x + (p2.x - p0.x) / 6;
                        const cp1y = p1.y + (p2.y - p0.y) / 6;
                        const cp2x = p2.x - (p3.x - p1.x) / 6;
                        const cp2y = p2.y - (p3.y - p1.y) / 6;
                        d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
                      }
                      return d;
                    };
                    const currentPath = toSmoothPath(currentVisible);
                    const yearAgoPath = toSmoothPath(yearAgoVisible);
                    return (
                      <div className="flex flex-1 min-h-[140px]">
                        <div className="flex items-center justify-center mr-1" style={{ width: '20px' }}>
                          <span className="-rotate-90 text-xs text-muted whitespace-nowrap">Yield</span>
                        </div>

                        <div className="flex-1 flex flex-col">
                          <div className="flex flex-1">
                            <div className="flex flex-col justify-between text-right pr-2" style={{ width: '28px' }}>
                              <span className="text-xs text-muted">5.0%</span>
                              <span className="text-xs text-muted">4.5%</span>
                              <span className="text-xs text-muted">4.0%</span>
                              <span className="text-xs text-muted">3.5%</span>
                            </div>

                            <div className="flex-1 relative border-l border-b border-zinc-700/50 overflow-hidden">
                              {/* Curves: yearAgo (dashed zinc) drawn first so current sits on top.
                                  Each path lives in its own reveal-wrapper so the year-ago line
                                  draws left-to-right first, then the current line draws after it. */}
                              <div className="yc-line-reveal absolute inset-0">
                                <svg
                                  className="absolute inset-0 w-full h-full"
                                  preserveAspectRatio="none"
                                  viewBox="0 0 100 100"
                                >
                                  <path
                                    d={yearAgoPath}
                                    fill="none"
                                    stroke="#a1a1aa"
                                    strokeWidth="1.5"
                                    strokeDasharray="3 2"
                                    vectorEffect="non-scaling-stroke"
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </div>
                              <div className="yc-line-reveal yc-line-reveal-current absolute inset-0">
                                <svg
                                  className="absolute inset-0 w-full h-full"
                                  preserveAspectRatio="none"
                                  viewBox="0 0 100 100"
                                >
                                  <path
                                    d={currentPath}
                                    fill="none"
                                    stroke="#1398A4"
                                    strokeWidth="2"
                                    vectorEffect="non-scaling-stroke"
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </div>

                              {/* Index dots — one per curve. Year-ago dot pops in right after the
                                  year-ago line finishes drawing; current dot waits for the current
                                  line. After the initial cascade, mid-session re-renders use 0ms. */}
                              {(() => {
                                const dur = FI_INDEX.avgEffDuration;
                                const currentY = interpolateYield(FI_YIELD_CURVE.current, FI_YIELD_CURVE.tenorYears, dur);
                                const yearAgoY = interpolateYield(FI_YIELD_CURVE.yearAgo, FI_YIELD_CURVE.tenorYears, dur);
                                const yearAgoDelay = initialStaggerDone ? '0ms' : `${ROW_3_STAGGER_MS + 1000}ms`;
                                const currentDelay = initialStaggerDone ? '0ms' : `${ROW_3_STAGGER_MS + 2500}ms`;
                                return (
                                  <>
                                    <div
                                      className="data-pop absolute w-4 h-4 rounded-full bg-zinc-500 border-2 border-zinc-400 z-10 cursor-pointer"
                                      style={{
                                        left: indexX(dur),
                                        top: pct(currentY, Y_MIN, Y_MAX, true),
                                        transform: 'translate(-50%, -50%)',
                                        animationDelay: currentDelay,
                                      }}
                                      {...dotHoverHandlers(`${FI_INDEX.creditBreakdownLabel} • Current`, [
                                        `Duration: ${fmtYears(dur)}`,
                                        `Yield: ${fmtPct2(currentY)}`,
                                      ])}
                                    />
                                    <div
                                      className="data-pop absolute w-4 h-4 rounded-full bg-zinc-500/60 border-2 border-zinc-400 z-10 cursor-pointer"
                                      style={{
                                        left: indexX(dur),
                                        top: pct(yearAgoY, Y_MIN, Y_MAX, true),
                                        transform: 'translate(-50%, -50%)',
                                        animationDelay: yearAgoDelay,
                                      }}
                                      {...dotHoverHandlers(`${FI_INDEX.creditBreakdownLabel} • 1Y Ago`, [
                                        `Duration: ${fmtYears(dur)}`,
                                        `Yield: ${fmtPct2(yearAgoY)}`,
                                      ])}
                                    />
                                  </>
                                );
                              })()}

                              {/* Portfolio dots — one per curve per portfolio. Same staged delays
                                  as the index dots; data-fade exits keep the row-stagger default. */}
                              {displayedPortfolios.map(({ name, idx, exiting }) => {
                                const dur = FI_PORTFOLIO_DATA[name].avgEffDuration;
                                const currentY = interpolateYield(FI_YIELD_CURVE.current, FI_YIELD_CURVE.tenorYears, dur);
                                const yearAgoY = interpolateYield(FI_YIELD_CURVE.yearAgo, FI_YIELD_CURVE.tenorYears, dur);
                                const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                                const cls = exiting ? 'data-fade' : 'data-pop';
                                const yearAgoDelay = exiting
                                  ? undefined
                                  : initialStaggerDone ? '0ms' : `${ROW_3_STAGGER_MS + 1000}ms`;
                                const currentDelay = exiting
                                  ? undefined
                                  : initialStaggerDone ? '0ms' : `${ROW_3_STAGGER_MS + 2500}ms`;
                                return (
                                  <React.Fragment key={name}>
                                    <div
                                      className={`${cls} absolute w-4 h-4 rounded-full border-2 z-10 cursor-pointer`}
                                      style={{
                                        left: indexX(dur),
                                        top: pct(currentY, Y_MIN, Y_MAX, true),
                                        transform: 'translate(-50%, -50%)',
                                        backgroundColor: color.hex,
                                        borderColor: color.hex,
                                        boxShadow: `0 0 14px ${color.glow}`,
                                        animationDelay: currentDelay,
                                      }}
                                      {...dotHoverHandlers(`${name} • Current`, [
                                        `Duration: ${fmtYears(dur)}`,
                                        `Yield: ${fmtPct2(currentY)}`,
                                      ])}
                                    />
                                    <div
                                      className={`${cls} absolute w-4 h-4 rounded-full border-2 z-10 cursor-pointer`}
                                      style={{
                                        left: indexX(dur),
                                        top: pct(yearAgoY, Y_MIN, Y_MAX, true),
                                        transform: 'translate(-50%, -50%)',
                                        backgroundColor: 'transparent',
                                        borderColor: color.hex,
                                        boxShadow: `0 0 8px ${color.glow}`,
                                        animationDelay: yearAgoDelay,
                                      }}
                                      {...dotHoverHandlers(`${name} • 1Y Ago`, [
                                        `Duration: ${fmtYears(dur)}`,
                                        `Yield: ${fmtPct2(yearAgoY)}`,
                                      ])}
                                    />
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex justify-around pl-7 pr-0 mt-1">
                            {tenorLabelsVisible.map(label => (
                              <span key={label} className="text-xs text-muted">{label}</span>
                            ))}
                          </div>

                          <div className="text-center mt-1">
                            <span className="text-xs text-muted">Tenor</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-center flex-wrap gap-x-6 gap-y-2 mt-3">
                    {displayedPortfolios.map(({ name, idx, exiting }) => {
                      const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                      return (
                        <div key={name} className={`flex items-center gap-2 ${exiting ? 'data-fade' : ''}`}>
                          <div
                            className="w-3 h-3 rounded-full border"
                            style={{ backgroundColor: color.hex, borderColor: color.hex }}
                          />
                          <span className="text-xs text-muted">{name}</span>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-zinc-500 border border-zinc-400" />
                      <span className="text-xs text-muted">{FI_INDEX.creditBreakdownLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 border-t-2 border-cyan-500" style={{ borderColor: '#1398A4' }} />
                      <span className="text-xs text-muted">Current</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 border-t-2 border-dashed border-zinc-500" />
                      <span className="text-xs text-muted">1 Year Ago</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* FI Row 2: Credit Breakdown (col-span-2) + Credit Spread (col-span-1) */}
            <div className="grid grid-cols-3 gap-4 mb-4 row-stagger-4">
              {/* Credit Breakdown — horizontal stacked bars per portfolio + index */}
              <div className="col-span-2 relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl flex flex-col min-h-[340px]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Credit Breakdown</h4>
                      <p className="text-xs text-muted">Allocation by credit rating ({period})</p>
                    </div>
                  </div>

                  {/* Wrapper holds its "compact" (justify-start) layout while a row is mid-enter
                      AND while a row is mid-exit — so the existing bars never re-center while a
                      bar is growing in or shrinking out. Only `entering` is excluded from the
                      visible count: `exiting` rows still occupy a slot until the row-exit collapse
                      finishes and PORTFOLIO_EXIT_MS sweeps them out. */}
                  <div
                    className={`flex-1 flex flex-col gap-3 transition-[padding-top] duration-500 ${
                      displayedPortfolios.filter(p => !p.entering).length === 1
                        ? 'justify-start pt-4'
                        : 'justify-center pt-0'
                    }`}
                  >
                    {displayedPortfolios.map(({ name, exiting, entering, settled }, rowIdx) => {
                      const dist = FI_PORTFOLIO_DATA[name].creditBreakdown;
                      return (
                        <div
                          key={name}
                          className={`${
                            exiting ? 'row-exit' : entering ? 'row-enter' : settled ? '' : 'data-pop'
                          } flex flex-col gap-1`}
                          style={{
                            animationDelay:
                              exiting || entering || settled ? '0ms' : `${ROW_4_STAGGER_MS + 80 + rowIdx * 120}ms`,
                          }}
                        >
                          <span
                            className={`text-xs font-medium text-zinc-400 ${
                              exiting ? 'label-exit' : entering ? 'label-enter' : ''
                            }`}
                          >
                            {name}
                          </span>
                          <div
                            className={`${
                              exiting ? 'bar-shrink' : settled ? '' : 'bar-grow'
                            } flex ${
                              displayedPortfolios.length === 1 ? 'h-14' : 'h-10'
                            } rounded-sm overflow-hidden border border-zinc-800/60 bg-zinc-500 gap-px transition-[height] duration-[900ms]`}
                            style={{
                              containerType: 'size',
                              animationDelay: exiting || settled
                                ? '0ms'
                                : entering
                                ? '900ms'
                                : `${ROW_4_STAGGER_MS + 80 + rowIdx * 120}ms`,
                              // Entering rows use a longer bar-grow so it stays in sync with the
                              // 1.5s label fade — initial-mount bars keep the default 1.1s duration.
                              animationDuration: entering ? '1500ms' : undefined,
                            }}
                          >
                            {CREDIT_BUCKETS.map(bucket => {
                              const pct = dist[bucket.id];
                              if (pct === 0) return null;
                              return (
                                <div
                                  key={bucket.id}
                                  className="h-full flex items-center justify-center overflow-hidden transition-[width] duration-700 ease-out cursor-pointer"
                                  style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                                  {...dotHoverHandlers(`${name} • ${bucket.label}`, [`${pct}%`])}
                                >
                                  {pct > 3 && (
                                    <span className="font-semibold tabular-nums" style={{ fontSize: '32cqh', color: bucket.textColor }}>{pct}%</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Index row — extra top padding when only one portfolio is selected,
                        so the index is visually distinct from the lone portfolio bar above.
                        Tied to `displayedPortfolios.length` (not `portfolioFilter.length`) so
                        the pt-3 / h-14 transitions wait for the exit cleanup to remove the
                        deselected row, matching the staged 2→1 reverse animation. */}
                    <div
                      className={`data-pop flex flex-col gap-1 transition-[padding-top] duration-[900ms] ${
                        displayedPortfolios.length === 1 ? 'pt-3' : 'pt-0'
                      }`}
                      style={{ animationDelay: `${ROW_4_STAGGER_MS + 80 + displayedPortfolios.length * 120}ms` }}
                    >
                      <span className="text-xs font-medium text-zinc-400">{FI_INDEX.creditBreakdownLabel}</span>
                      <div
                        className={`bar-grow flex ${
                          displayedPortfolios.length === 1 ? 'h-14' : 'h-10'
                        } rounded-sm overflow-hidden border border-zinc-800/60 bg-zinc-500 gap-px transition-[height] duration-[900ms]`}
                        style={{
                          containerType: 'size',
                          animationDelay: `${ROW_4_STAGGER_MS + 80 + displayedPortfolios.length * 120}ms`,
                        }}
                      >
                        {CREDIT_BUCKETS.map(bucket => {
                          const pct = FI_INDEX.creditBreakdown[bucket.id];
                          if (pct === 0) return null;
                          return (
                            <div
                              key={bucket.id}
                              className="h-full flex items-center justify-center overflow-hidden transition-[width] duration-700 ease-out cursor-pointer"
                              style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                              {...dotHoverHandlers(`${FI_INDEX.creditBreakdownLabel} • ${bucket.label}`, [`${pct}%`])}
                            >
                              {pct > 3 && (
                                <span className="font-semibold tabular-nums" style={{ fontSize: '32cqh', color: bucket.textColor }}>{pct}%</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Bucket legend */}
                  <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2 mt-4">
                    {CREDIT_BUCKETS.map(bucket => (
                      <div key={bucket.id} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: bucket.color }} />
                        <span className="text-xs text-muted">{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Credit Spread — slider snapshot or historical line chart, toggled */}
              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl flex flex-col min-h-[340px]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2 -mr-2">
                    <div className="group relative">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-medium text-white">Credit Spread</h4>
                        <button
                          type="button"
                          tabIndex={0}
                          className="text-zinc-500 hover:text-zinc-200 focus-visible:text-zinc-200 cursor-help focus:outline-none"
                          aria-label="About the Credit Spread bar"
                        >
                          <Info className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-xs text-muted">
                        {creditSpreadView === 'slider' ? `Current spread (${period})` : 'Spread over time'}
                      </p>
                      <div
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity absolute top-full left-0 mt-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md w-72 pointer-events-none z-50 shadow-lg text-left"
                        role="tooltip"
                      >
                        <div className="text-xs font-medium text-white mb-1">Credit Spread vs. History</div>
                        <div className="text-xs text-muted leading-snug">
                          The bar shows where the current <span className="text-zinc-200">Bloomberg US Credit</span> − <span className="text-zinc-200">US Treasury</span> spread sits across its 10-year range.
                          Left (<span className="text-zinc-200">Narrow</span>) = lower risk premium; right (<span className="text-zinc-200">Wide</span>) = higher.
                          The dial tracks today&apos;s index reading. Portfolio dots are anchored at the dial and offset by each portfolio&apos;s credit overweight vs the index —
                          right of the dial = overweight credit, left = overweight government.
                        </div>
                      </div>
                    </div>
                    {/* Slider / Chart toggle — far right of header */}
                    <div className="flex items-center gap-0.5 p-0.5 bg-zinc-800/60 rounded-md border border-zinc-700/40">
                      {(['slider', 'chart'] as const).map(view => {
                        const active = creditSpreadView === view;
                        return (
                          <button
                            key={view}
                            type="button"
                            onClick={() => setCreditSpreadView(view)}
                            className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
                              active ? 'bg-zinc-700 text-white' : 'text-muted hover:text-white'
                            }`}
                          >
                            {view === 'slider' ? 'Slider' : 'Chart'}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {creditSpreadView === 'slider' ? (
                    <div className="flex flex-col justify-start px-1 pt-14">
                      {(() => {
                        const avgPct =
                          ((FI_SPREAD_CONTEXT.tenYearAvg - SPREAD_AXIS_MIN) / (SPREAD_AXIS_MAX - SPREAD_AXIS_MIN)) * 100;
                        return (
                          <div className="relative">
                            {/* Index dial — pill above the bar, caret, vertical line through bar */}
                            <div
                              className="data-pop absolute z-20"
                              style={{
                                left: spreadBarPos(FI_INDEX.spreadBps),
                                top: 0,
                                bottom: 0,
                                transition: 'left 500ms ease-out',
                                animationDelay: initialStaggerDone ? '0ms' : undefined,
                              }}
                            >
                              <div
                                className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1 rounded-md bg-zinc-500 text-white text-sm font-medium shadow-md whitespace-nowrap cursor-pointer"
                                {...dotHoverHandlers(FI_INDEX.spreadLabel, [`${FI_INDEX.spreadBps} bps`])}
                              >
                                {FI_INDEX.spreadBps} bps
                              </div>
                              <div
                                className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0"
                                style={{
                                  borderLeft: '7px solid transparent',
                                  borderRight: '7px solid transparent',
                                  borderTop: '7px solid #e4e4e7',
                                }}
                              />
                              <div className="absolute top-0 h-14 left-1/2 -translate-x-1/2 w-px bg-zinc-200/80" />
                            </div>

                            {/* The bar — gradient: white (Narrow) ramps quickly to teal (Wide), squared corners */}
                            <div
                              className="data-pop relative h-12 shadow-inner overflow-hidden"
                              style={{
                                background: 'linear-gradient(to right, #ffffff 0%, #0E727B 20%, #0E727B 100%)',
                                animationDelay: initialStaggerDone ? '0ms' : undefined,
                              }}
                            >
                              {/* In-bar edge labels */}
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm uppercase tracking-wide text-zinc-900 font-semibold pointer-events-none">
                                Narrow
                              </span>
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm uppercase tracking-wide text-white font-semibold pointer-events-none">
                                Wide
                              </span>
                              {/* 10-yr avg interior tick — anchors the gradient transition visually */}
                              <div
                                className="absolute top-0 bottom-0 w-px bg-zinc-300/50 cursor-pointer"
                                style={{ left: `${avgPct}%` }}
                                {...dotHoverHandlers('10-Yr Avg', [`${FI_SPREAD_CONTEXT.tenYearAvg} bps`])}
                              />
                            </div>

                            {/* Portfolio dots row — under the bar, positioned by credit overweight vs index */}
                            <div className="relative h-6 mt-1">
                              {displayedPortfolios.map(({ name, idx, exiting }) => {
                                const creditWeight = FI_PORTFOLIO_DATA[name].creditWeight;
                                const overweight = creditWeight - FI_INDEX.creditWeight;
                                const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                                return (
                                  <div
                                    key={name}
                                    className={`${exiting ? 'data-fade' : 'data-pop'} absolute`}
                                    style={{
                                      left: tiltBarPos(creditWeight),
                                      top: 0,
                                      transform: 'translateX(-50%)',
                                      transition: 'left 500ms ease-out',
                                      animationDelay: initialStaggerDone ? '0ms' : undefined,
                                    }}
                                  >
                                    <div
                                      className="absolute w-px left-1/2 -translate-x-1/2"
                                      style={{ backgroundColor: color.hex, bottom: '100%', height: '60px' }}
                                    />
                                    <div
                                      className="w-5 h-5 rounded-full border-2 cursor-pointer mx-auto"
                                      style={{
                                        backgroundColor: color.hex,
                                        borderColor: color.hex,
                                        boxShadow: `0 0 14px ${color.glow}`,
                                      }}
                                      {...dotHoverHandlers(name, [
                                        `${creditWeight}% credit`,
                                        `${overweight >= 0 ? '+' : '−'}${Math.abs(overweight)}% vs ${FI_INDEX.creditBreakdownLabel}`,
                                      ])}
                                    />
                                  </div>
                                );
                              })}
                            </div>

                            {displayedPortfolios.length === 0 && (
                              <div className="text-center text-xs text-muted mt-3">
                                Add portfolios to compare credit-vs-government tilt.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="h-[140px] -ml-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={creditSpreadSeries} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
                          <XAxis
                            dataKey="period"
                            stroke="#71717a"
                            tick={{ fontSize: 10, fill: '#a1a1aa' }}
                            tickLine={false}
                            axisLine={{ stroke: '#3f3f46' }}
                            angle={-30}
                            textAnchor="end"
                            tickMargin={20}
                            height={50}
                            interval={0}
                          />
                          <YAxis
                            yAxisId="bps"
                            domain={bpsAxis.domain}
                            ticks={bpsAxis.ticks}
                            stroke="#71717a"
                            tick={{ fontSize: 10, fill: '#a1a1aa' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => `${v}`}
                            width={32}
                          />
                          {/* Right axis — portfolio credit allocation % (rising line = tilt toward credit) */}
                          <YAxis
                            yAxisId="weight"
                            domain={weightAxis.domain}
                            ticks={weightAxis.ticks}
                            orientation="right"
                            stroke="#71717a"
                            tick={{ fontSize: 10, fill: '#a1a1aa' }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) => `${v}%`}
                            width={36}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#27272a',
                              border: '1px solid #3f3f46',
                              borderRadius: '6px',
                              fontSize: '12px',
                            }}
                            labelStyle={{ color: '#fff', marginBottom: '4px', fontWeight: 500 }}
                            itemStyle={{ color: '#a1a1aa', padding: 0 }}
                            formatter={(value, name) =>
                              name === FI_INDEX.spreadLabel
                                ? [`${value} bps`, name]
                                : [`${value}% credit`, name]
                            }
                          />
                          {/* Index line — Credit − Treasury yield spread (bps), left axis */}
                          <Line
                            yAxisId="bps"
                            type="monotone"
                            dataKey={FI_INDEX.spreadLabel}
                            stroke="#a1a1aa"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                            isAnimationActive
                          />
                          {displayedPortfolios.filter(p => !p.exiting).map(({ name, idx }) => {
                            const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                            return (
                              <Line
                                key={name}
                                yAxisId="weight"
                                type="monotone"
                                dataKey={name}
                                stroke={color.hex}
                                strokeWidth={2}
                                dot={{ fill: color.hex, r: 3, strokeWidth: 0 }}
                                activeDot={{ r: 5, fill: color.hex, strokeWidth: 0 }}
                                isAnimationActive
                              />
                            );
                          })}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Summary — slider view shows current snapshot (narrow/wide vs 10-yr avg + per-portfolio
                      tilt vs index); chart view shows 8-quarter trajectory (spread direction + per-portfolio
                      credit allocation change). */}
                  {(() => {
                    const visible = displayedPortfolios.filter(p => !p.exiting);
                    if (creditSpreadView === 'chart') {
                      const hist = FI_INDEX.spreadHistory;
                      const spreadFirst = hist[0];
                      const spreadLast = hist[hist.length - 1];
                      const spreadDelta = spreadLast - spreadFirst;
                      const spreadDirection =
                        spreadDelta > 0 ? 'widened' : spreadDelta < 0 ? 'narrowed' : 'held flat';
                      // Highlight the peak when spreads widened net, the trough when they
                      // narrowed — that's the more informative outlier in each case.
                      const isWiden = spreadDelta > 0;
                      const extreme = isWiden ? Math.max(...hist) : Math.min(...hist);
                      const extremeLabel = isWiden ? 'high' : 'low';
                      const showExtreme = extreme !== spreadFirst && extreme !== spreadLast;
                      return (
                        <p className="text-base text-muted leading-relaxed text-left mt-4 px-1">
                          Spreads{' '}
                          <span className="text-white font-medium">{spreadDirection}</span>{' '}
                          from {spreadFirst} to {spreadLast} bps
                          {showExtreme && ` (${extremeLabel} ${extreme})`}.
                          {visible.length > 0 && ' '}
                          {visible.map(({ name, idx }, i) => {
                            const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                            const h = FI_PORTFOLIO_DATA[name].creditWeightHistory;
                            const startW = h[0];
                            const endW = h[h.length - 1];
                            const wDelta = endW - startW;
                            const isLast = i === visible.length - 1;
                            return (
                              <span key={name}>
                                <span style={{ color: color.hex }} className="font-medium">{name}</span>{' '}
                                {wDelta === 0
                                  ? `flat at ${endW}%`
                                  : `${wDelta > 0 ? 'added' : 'trimmed'} ${Math.abs(wDelta)}pp (${startW}% → ${endW}%)`}
                                {isLast ? '.' : '; '}
                              </span>
                            );
                          })}
                        </p>
                      );
                    }
                    const isNarrow = FI_INDEX.spreadBps < FI_SPREAD_CONTEXT.tenYearAvg;
                    return (
                      <p className="text-base text-muted leading-relaxed text-left mt-4 px-1">
                        Credit spreads are currently{' '}
                        <span className="text-white font-medium">{isNarrow ? 'narrow' : 'wide'}</span>{' '}
                        relative to the 10-yr average ({FI_INDEX.spreadBps} bps vs {FI_SPREAD_CONTEXT.tenYearAvg} bps).
                        {visible.length > 0 && ' '}
                        {visible.map(({ name, idx }, i) => {
                          const color = PORTFOLIO_PALETTE[idx] ?? PORTFOLIO_PALETTE[0];
                          const overweight = FI_PORTFOLIO_DATA[name].creditWeight - FI_INDEX.creditWeight;
                          const isLast = i === visible.length - 1;
                          return (
                            <span key={name}>
                              <span style={{ color: color.hex }} className="font-medium">{name}</span>{' '}
                              {overweight === 0
                                ? 'matches the index credit weight'
                                : `is ${overweight > 0 ? 'overweight' : 'underweight'} credit by ${Math.abs(overweight)}pp`}
                              {isLast ? '.' : '; '}
                            </span>
                          );
                        })}
                      </p>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* FI Row 3: Security Type — full width */}
            <div className="mb-4 row-stagger-5">
              {/* Security Type — horizontal stacked bars per portfolio + index */}
              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl flex flex-col min-h-[340px]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Security Type</h4>
                      <p className="text-xs text-muted">Allocation by instrument type ({period})</p>
                    </div>
                  </div>

                  <div
                    className={`flex-1 flex flex-col gap-3 transition-[padding-top] duration-500 ${
                      displayedPortfolios.filter(p => !p.entering).length === 1
                        ? 'justify-start pt-4'
                        : 'justify-center pt-0'
                    }`}
                  >
                    {displayedPortfolios.map(({ name, exiting, entering, settled }, rowIdx) => {
                      const dist = FI_PORTFOLIO_DATA[name].securityType;
                      return (
                        <div
                          key={name}
                          className={`${
                            exiting ? 'row-exit' : entering ? 'row-enter' : settled ? '' : 'data-pop'
                          } flex flex-col gap-1`}
                          style={{
                            animationDelay:
                              exiting || entering || settled ? '0ms' : `${ROW_5_STAGGER_MS + 80 + rowIdx * 120}ms`,
                          }}
                        >
                          <span
                            className={`text-xs font-medium text-zinc-400 ${
                              exiting ? 'label-exit' : entering ? 'label-enter' : ''
                            }`}
                          >
                            {name}
                          </span>
                          <div
                            className={`${
                              exiting ? 'bar-shrink' : settled ? '' : 'bar-grow'
                            } flex ${
                              displayedPortfolios.length === 1 ? 'h-14' : 'h-10'
                            } rounded-sm overflow-hidden border border-zinc-800/60 bg-zinc-500 gap-px transition-[height] duration-[900ms]`}
                            style={{
                              containerType: 'size',
                              animationDelay: exiting || settled
                                ? '0ms'
                                : entering
                                ? '900ms'
                                : `${ROW_5_STAGGER_MS + 80 + rowIdx * 120}ms`,
                              animationDuration: entering ? '1500ms' : undefined,
                            }}
                          >
                            {SECURITY_TYPE_BUCKETS.map(bucket => {
                              const pct = dist[bucket.id];
                              if (pct === 0) return null;
                              return (
                                <div
                                  key={bucket.id}
                                  className="h-full flex items-center justify-center overflow-hidden transition-[width] duration-700 ease-out cursor-pointer"
                                  style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                                  {...dotHoverHandlers(`${name} • ${bucket.label}`, [`${pct}%`])}
                                >
                                  {pct > 3 && (
                                    <span className="font-semibold tabular-nums" style={{ fontSize: '32cqh', color: bucket.textColor }}>{pct}%</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Index row */}
                    <div
                      className={`data-pop flex flex-col gap-1 transition-[padding-top] duration-[900ms] ${
                        displayedPortfolios.length === 1 ? 'pt-3' : 'pt-0'
                      }`}
                      style={{ animationDelay: `${ROW_5_STAGGER_MS + 80 + displayedPortfolios.length * 120}ms` }}
                    >
                      <span className="text-xs font-medium text-zinc-400">{FI_INDEX.securityTypeLabel}</span>
                      <div
                        className={`bar-grow flex ${
                          displayedPortfolios.length === 1 ? 'h-14' : 'h-10'
                        } rounded-sm overflow-hidden border border-zinc-800/60 bg-zinc-500 gap-px transition-[height] duration-[900ms]`}
                        style={{
                          containerType: 'size',
                          animationDelay: `${ROW_5_STAGGER_MS + 80 + displayedPortfolios.length * 120}ms`,
                        }}
                      >
                        {SECURITY_TYPE_BUCKETS.map(bucket => {
                          const pct = FI_INDEX.securityType[bucket.id];
                          if (pct === 0) return null;
                          return (
                            <div
                              key={bucket.id}
                              className="h-full flex items-center justify-center overflow-hidden transition-[width] duration-700 ease-out cursor-pointer"
                              style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                              {...dotHoverHandlers(`${FI_INDEX.securityTypeLabel} • ${bucket.label}`, [`${pct}%`])}
                            >
                              {pct > 3 && (
                                <span className="font-semibold tabular-nums" style={{ fontSize: '32cqh', color: bucket.textColor }}>{pct}%</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Bucket legend */}
                  <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2 mt-4">
                    {SECURITY_TYPE_BUCKETS.map(bucket => (
                      <div key={bucket.id} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: bucket.color }} />
                        <span className="text-xs text-muted">{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* FI Row 4: Maturity Breakdown — full width */}
            <div className="mb-4 row-stagger-6">
              {/* Maturity Breakdown — horizontal stacked bars per portfolio + index */}
              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl flex flex-col min-h-[340px]">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                <div className="relative z-10 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-4 -mt-2 -ml-2">
                    <div>
                      <h4 className="text-sm font-medium text-white">Maturity Breakdown</h4>
                      <p className="text-xs text-muted">Allocation by maturity bucket ({period})</p>
                    </div>
                  </div>

                  <div
                    className={`flex-1 flex flex-col gap-3 transition-[padding-top] duration-500 ${
                      displayedPortfolios.filter(p => !p.entering).length === 1
                        ? 'justify-start pt-4'
                        : 'justify-center pt-0'
                    }`}
                  >
                    {displayedPortfolios.map(({ name, exiting, entering, settled }, rowIdx) => {
                      const dist = FI_PORTFOLIO_DATA[name].maturityBreakdown;
                      return (
                        <div
                          key={name}
                          className={`${
                            exiting ? 'row-exit' : entering ? 'row-enter' : settled ? '' : 'data-pop'
                          } flex flex-col gap-1`}
                          style={{
                            animationDelay:
                              exiting || entering || settled ? '0ms' : `${ROW_6_STAGGER_MS + 80 + rowIdx * 120}ms`,
                          }}
                        >
                          <span
                            className={`text-xs font-medium text-zinc-400 ${
                              exiting ? 'label-exit' : entering ? 'label-enter' : ''
                            }`}
                          >
                            {name}
                          </span>
                          <div
                            className={`${
                              exiting ? 'bar-shrink' : settled ? '' : 'bar-grow'
                            } flex ${
                              displayedPortfolios.length === 1 ? 'h-14' : 'h-10'
                            } rounded-sm overflow-hidden border border-zinc-800/60 bg-zinc-500 gap-px transition-[height] duration-[900ms]`}
                            style={{
                              containerType: 'size',
                              animationDelay: exiting || settled
                                ? '0ms'
                                : entering
                                ? '900ms'
                                : `${ROW_6_STAGGER_MS + 80 + rowIdx * 120}ms`,
                              animationDuration: entering ? '1500ms' : undefined,
                            }}
                          >
                            {MATURITY_BUCKETS.map(bucket => {
                              const pct = dist[bucket.id];
                              if (pct === 0) return null;
                              return (
                                <div
                                  key={bucket.id}
                                  className="h-full flex items-center justify-center overflow-hidden transition-[width] duration-700 ease-out cursor-pointer"
                                  style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                                  {...dotHoverHandlers(`${name} • ${bucket.label}`, [`${pct}%`])}
                                >
                                  {pct > 3 && (
                                    <span className="font-semibold tabular-nums" style={{ fontSize: '32cqh', color: bucket.textColor }}>{pct}%</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}

                    {/* Index row */}
                    <div
                      className={`data-pop flex flex-col gap-1 transition-[padding-top] duration-[900ms] ${
                        displayedPortfolios.length === 1 ? 'pt-3' : 'pt-0'
                      }`}
                      style={{ animationDelay: `${ROW_6_STAGGER_MS + 80 + displayedPortfolios.length * 120}ms` }}
                    >
                      <span className="text-xs font-medium text-zinc-400">{FI_INDEX.maturityBreakdownLabel}</span>
                      <div
                        className={`bar-grow flex ${
                          displayedPortfolios.length === 1 ? 'h-14' : 'h-10'
                        } rounded-sm overflow-hidden border border-zinc-800/60 bg-zinc-500 gap-px transition-[height] duration-[900ms]`}
                        style={{
                          containerType: 'size',
                          animationDelay: `${ROW_6_STAGGER_MS + 80 + displayedPortfolios.length * 120}ms`,
                        }}
                      >
                        {MATURITY_BUCKETS.map(bucket => {
                          const pct = FI_INDEX.maturityBreakdown[bucket.id];
                          if (pct === 0) return null;
                          return (
                            <div
                              key={bucket.id}
                              className="h-full flex items-center justify-center overflow-hidden transition-[width] duration-700 ease-out cursor-pointer"
                              style={{ width: `${pct}%`, backgroundColor: bucket.color }}
                              {...dotHoverHandlers(`${FI_INDEX.maturityBreakdownLabel} • ${bucket.label}`, [`${pct}%`])}
                            >
                              {pct > 3 && (
                                <span className="font-semibold tabular-nums" style={{ fontSize: '32cqh', color: bucket.textColor }}>{pct}%</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Bucket legend */}
                  <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-2 mt-4">
                    {MATURITY_BUCKETS.map(bucket => (
                      <div key={bucket.id} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: bucket.color }} />
                        <span className="text-xs text-muted">{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          )}
        </div>

        {/* Hover tooltip for Style Map / Profitability Map dots */}
        {dotTooltip && (
          <div
            className="fixed px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-md whitespace-nowrap pointer-events-none z-50 shadow-lg"
            style={{ left: dotTooltip.x + 14, top: dotTooltip.y + 4 }}
          >
            <div className="font-medium text-white">{dotTooltip.label}</div>
            {dotTooltip.lines.map(line => (
              <div key={line} className="text-muted font-mono">{line}</div>
            ))}
          </div>
        )}
    </>
  );
}
