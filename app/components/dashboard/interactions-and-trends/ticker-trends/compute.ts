// Pure derivation helpers for the Ticker Trends competitor-demand dashboard.
// Ported near-verbatim from the design handoff prototype
// (design_handoff_ticker_trends/Ticker Trends Redesign.dc.html) so the scoring,
// chart geometry, and formatting stay pixel/behavior-accurate. Everything here
// is a pure function over the `HotTicker` shape — no React, no state.

import type { CSSProperties } from 'react';
import type { HotTicker } from '@/app/lib/types/trends';

export type Department = 'All Departments' | 'Advisory' | 'Brokerage' | 'Institutional';
export type TeamName = 'Advisory' | 'Brokerage' | 'Institutional';

// ── Constants ────────────────────────────────────────────────────────────────

export const QUARTERS = [
  'Q2 2022', 'Q3 2022', 'Q4 2022', 'Q1 2023', 'Q2 2023', 'Q3 2023',
  'Q4 2023', 'Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024',
];

export const TEAMS: TeamName[] = ['Advisory', 'Brokerage', 'Institutional'];

export const TEAM_COLORS: Record<TeamName, string> = {
  Advisory: '#22d3ee',
  Brokerage: '#0e7490',
  Institutional: '#4f46e5',
};

export const TEAM_QOQ: Record<TeamName, string> = {
  Advisory: '+7%',
  Brokerage: '+2%',
  Institutional: '-1%',
};

export const CATS = [
  { k: 'pcrRequests', n: 'PCR Requests', c: '#a5f3fc' },
  { k: 'pcrDownloads', n: 'PCR Downloads', c: '#22d3ee' },
  { k: 'tickersMentioned', n: 'Tickers Mentioned', c: '#0e7490' },
  { k: 'clientModels', n: 'Client Models', c: '#4f46e5' },
] as const;

// Tickers with no direct firm equivalent (short-circuit the Firm Edge score).
export const NO_EQUIV = ['QQQ', 'GLD', 'ARKK'];

export const DEPARTMENTS: Department[] = ['All Departments', 'Advisory', 'Brokerage', 'Institutional'];
export const PERIODS = ['1M', '3M', '6M', '1Y', 'YTD', 'All'];

// ── Series helpers ───────────────────────────────────────────────────────────

/** The 11-quarter request series as plain numbers. */
export function qSeries(t: HotTicker): number[] {
  return (t.quarterlyRequests ?? []).map((q) => q.requests);
}

export function isNoEquiv(t: HotTicker): boolean {
  return NO_EQUIV.indexOf(t.ticker) !== -1;
}

/** Parse strings like "82B" / "+2.1B" → numeric billions. */
export function parseB(s: string): number {
  return parseFloat(String(s).replace(/[+B]/g, ''));
}

export function trendN(t: HotTicker): number {
  return parseInt(t.trend, 10) || 0;
}

export function qoqOf(t: HotTicker): number {
  const q = qSeries(t);
  const last = q[q.length - 1];
  const prev = q[q.length - 2];
  return prev ? Math.round(((last - prev) / prev) * 100) : 0;
}

export function avgQoq(list: HotTicker[]): number {
  if (!list.length) return 0;
  return Math.round(list.reduce((a, t) => a + qoqOf(t), 0) / list.length);
}

/** Request count under the current department lens. */
export function reqOf(t: HotTicker, department: Department): number {
  return department === 'All Departments' ? t.requests : t.split[department];
}

export function totalOf(t: HotTicker): number {
  const b = t.requestBreakdown;
  if (!b) return 0;
  return b.pcrRequests + b.pcrDownloads + b.tickersMentioned + b.clientModels;
}

// ── Chip / badge style objects ───────────────────────────────────────────────

export interface TypePalette { bg: string; fg: string; bd: string }

export function typePalette(type: string): TypePalette {
  if (type === 'Replacement') return { bg: 'rgba(16,185,129,0.15)', fg: '#34d399', bd: 'rgba(16,185,129,0.3)' };
  if (type === 'Challenging') return { bg: 'rgba(239,68,68,0.15)', fg: '#f87171', bd: 'rgba(239,68,68,0.3)' };
  return { bg: 'rgba(245,158,11,0.15)', fg: '#fbbf24', bd: 'rgba(245,158,11,0.3)' };
}

export function trendChipStyle(n: number): CSSProperties {
  return {
    display: 'inline-block', padding: '2px 7px', fontSize: '11px', fontWeight: 700,
    background: n >= 0 ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.14)',
    color: n >= 0 ? '#34d399' : '#f87171', whiteSpace: 'nowrap',
  };
}

export function devBadgeStyle(dev: number): CSSProperties {
  const base: CSSProperties = { display: 'inline-block', padding: '2px 7px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap' };
  if (dev > 0) return { ...base, background: 'rgba(16,185,129,0.15)', color: '#34d399' };
  if (dev < 0) return { ...base, background: 'rgba(239,68,68,0.15)', color: '#f87171' };
  return { ...base, background: 'rgba(113,113,122,0.15)', color: '#a1a1aa' };
}

// ── Request-type breakdown segments ──────────────────────────────────────────

export interface Segment { name: string; val: number; style: CSSProperties; dot: CSSProperties }

export function segsOf(t: HotTicker): Segment[] {
  const b = t.requestBreakdown;
  const total = totalOf(t) || 1;
  return CATS.map((c) => {
    const val = b ? b[c.k] : 0;
    return {
      name: c.n,
      val,
      style: { width: Math.max(0.5, (val / total) * 100) + '%', background: c.c, height: '100%' },
      dot: { display: 'inline-block', width: '8px', height: '8px', background: c.c, borderRadius: '2px' },
    };
  });
}

export interface TeamSegment { name: TeamName; val: number; style: CSSProperties; dot: CSSProperties }

export function teamSegsOf(t: HotTicker): TeamSegment[] {
  const total = t.requests || 1;
  return TEAMS.map((tm) => ({
    name: tm,
    val: t.split[tm],
    style: { width: Math.max(1, (t.split[tm] / total) * 100) + '%', background: TEAM_COLORS[tm], height: '100%' },
    dot: { display: 'inline-block', width: '8px', height: '8px', background: TEAM_COLORS[tm], borderRadius: '2px' },
  }));
}

// ── Deterministic placeholder reference metrics ──────────────────────────────
// Holdings / Market Cap / P/B / Profitability / Since Inception are illustrative:
// generated deterministically per-ticker (hash of ticker + a per-metric key into
// a fixed range) so they're stable but are placeholders. Wire to real fund
// reference data in production.

interface ExtMetrics {
  holdC: number; holdF: number; mcC: number; mcF: number;
  pbC: number; pbF: number; prC: number; prF: number; siC: number; siF: number;
}

const extCache = new Map<string, ExtMetrics>();

export function extMetrics(t: HotTicker): ExtMetrics {
  const cached = extCache.get(t.ticker);
  if (cached) return cached;
  const hash = (s: string) => {
    let x = 0;
    for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0;
    return x;
  };
  const rng = (k: string, min: number, max: number) => min + ((hash(t.ticker + k) % 1000) / 1000) * (max - min);
  const ext: ExtMetrics = {
    holdC: Math.round(rng('hc', 60, 2500)), holdF: Math.round(rng('hf', 60, 2500)),
    mcC: rng('mcc', 15, 480), mcF: rng('mcf', 15, 480),
    pbC: rng('pbc', 1.2, 4.6), pbF: rng('pbf', 1.2, 4.6),
    prC: rng('prc', 18, 42), prF: rng('prf', 18, 42),
    siC: rng('sic', 4, 12), siF: rng('sif', 4, 12),
  };
  extCache.set(t.ticker, ext);
  return ext;
}

// ── Proof points (8 ordered comparison rows) ─────────────────────────────────

export interface ProofRow { label: string; c: string; f: string; cw: CSSProperties; fw: CSSProperties }

export function proofOf(t: HotTicker): ProofRow[] {
  const bar = (color: string, frac: number): CSSProperties => ({
    height: '100%', background: color, width: Math.round(Math.max(0.04, frac) * 100) + '%',
  });
  const row = (label: string, cv: number, fv: number, cd: string, fd: string): ProofRow => {
    const m = Math.max(Math.abs(cv), Math.abs(fv)) || 1;
    return { label, c: cd, f: fd, cw: bar('#22d3ee', Math.abs(cv) / m), fw: bar('#fbbf24', Math.abs(fv) / m) };
  };
  const e = extMetrics(t);
  const aC = parseB(t.aum.competitor), aF = parseB(t.aum.firm);
  return [
    row('AUM', aC, aF, '$' + t.aum.competitor, '$' + t.aum.firm),
    row('Expense', t.expenseRatio.competitor, t.expenseRatio.firm, t.expenseRatio.competitor.toFixed(2) + '%', t.expenseRatio.firm.toFixed(2) + '%'),
    row('Holdings', e.holdC, e.holdF, e.holdC.toLocaleString(), e.holdF.toLocaleString()),
    row('Market Cap', e.mcC, e.mcF, '$' + Math.round(e.mcC) + 'B', '$' + Math.round(e.mcF) + 'B'),
    row('P/B', e.pbC, e.pbF, e.pbC.toFixed(1) + 'x', e.pbF.toFixed(1) + 'x'),
    row('Profitability', e.prC, e.prF, e.prC.toFixed(0) + '%', e.prF.toFixed(0) + '%'),
    row('1 Yr', t.returnComparison.competitor, t.returnComparison.firm, t.returnComparison.competitor + '%', t.returnComparison.firm + '%'),
    row('Since Incep.', e.siC, e.siF, e.siC.toFixed(1) + '%', e.siF.toFixed(1) + '%'),
  ];
}

// ── Firm Edge composite score ────────────────────────────────────────────────

export interface FirmEdge { score: number | null; tier: string; color: string; bg: string; sub: string }

export function firmEdge(t: HotTicker): FirmEdge {
  if (isNoEquiv(t)) {
    return { score: null, tier: 'No match', color: '#fbbf24', bg: 'rgba(245,158,11,0.15)', sub: 'No direct firm equivalent' };
  }
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  const c = t.returnComparison.competitor, f = t.returnComparison.firm;
  const cf = parseB(t.flows.competitor), ff = parseB(t.flows.firm);
  const ca = parseB(t.aum.competitor), fa = parseB(t.aum.firm);
  const retN = clamp((f - c) / 6);                         // return delta, ~6pp swing = full mark
  const feeN = clamp((t.expenseRatio.competitor - t.expenseRatio.firm) / 0.15); // firm cheaper is positive
  const firmGrowth = fa ? ff / fa : 0, compGrowth = ca ? cf / ca : 0;
  const flowN = clamp((firmGrowth - compGrowth) / 0.08);   // organic growth: net flow / AUM
  const score = Math.round((0.5 * retN + 0.25 * feeN + 0.25 * flowN) * 100);
  let tier: string, color: string, bg: string;
  if (score >= 20) { tier = 'Strong edge'; color = '#34d399'; bg = 'rgba(16,185,129,0.15)'; }
  else if (score >= 5) { tier = 'Edge'; color = '#34d399'; bg = 'rgba(16,185,129,0.12)'; }
  else if (score > -5) { tier = 'Even'; color = '#a1a1aa'; bg = 'rgba(113,113,122,0.15)'; }
  else if (score > -20) { tier = 'Behind'; color = '#f87171'; bg = 'rgba(239,68,68,0.12)'; }
  else { tier = 'Trailing'; color = '#f87171'; bg = 'rgba(239,68,68,0.15)'; }
  const wins: string[] = [], losses: string[] = [];
  const noop = { push() {} };
  (f > c ? wins : (f < c ? losses : noop)).push('return');
  (t.expenseRatio.firm < t.expenseRatio.competitor ? wins : (t.expenseRatio.firm > t.expenseRatio.competitor ? losses : noop)).push('fees');
  (firmGrowth > compGrowth ? wins : (firmGrowth < compGrowth ? losses : noop)).push('flows');
  let sub: string;
  if (wins.length && losses.length) sub = 'Wins ' + wins.join('/') + ' · trails ' + losses.join('/');
  else if (wins.length) sub = 'Wins on ' + wins.join('/');
  else if (losses.length) sub = 'Trails on ' + losses.join('/');
  else sub = 'Even across metrics';
  return { score, tier, color, bg, sub };
}

export interface EdgeParts { badge: CSSProperties; label: string; scoreStyle: CSSProperties; scoreText: string; sub: string }

export function edgeParts(t: HotTicker): EdgeParts {
  const e = firmEdge(t);
  return {
    badge: { display: 'inline-block', padding: '3px 8px', fontSize: '11px', fontWeight: 700, background: e.bg, color: e.color, whiteSpace: 'nowrap' },
    label: e.tier,
    scoreStyle: { fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: e.color },
    scoreText: e.score == null ? '—' : (e.score > 0 ? '+' : '') + e.score,
    sub: e.sub,
  };
}
