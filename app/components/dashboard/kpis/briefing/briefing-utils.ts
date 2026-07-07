/**
 * Pure helpers for the "Briefing" Team KPIs redesign.
 *
 * Formatting, period phrasing, hero-card delta styling, and — critically — the
 * verdict-sentence builders. Every string here is ported verbatim from the design
 * handoff's prototype logic (reference/Redesign D - Briefing.dc.html → renderVals)
 * so the copy matches the design exactly. The metric MATH lives server-side; this
 * module only turns already-computed numbers into words.
 */
import { formatCurrency, formatNumber } from '../utils';
import { toDisplayDate } from '@/app/lib/db/dateUtils';
import type { KpiDashboardData, SegmentMatrix } from '@/app/lib/api/kpi';

// ---------- formatting (aliases matching the reference names) ----------

export const fmtCur = formatCurrency;
export const fmtInt = formatNumber;
/** "Jan 6, 2025" from an ISO ("YYYY-MM-DD") date string. */
export const fmtDate = (iso: string) => toDisplayDate(iso);

// ---------- period phrasing ----------

export const PERIOD_LONG: Record<string, string> = {
  '1M': 'the past month',
  '3M': 'the past quarter',
  '6M': 'the past six months',
  YTD: 'year to date',
  '1Y': 'the trailing year',
  ALL: 'all time',
};

export const HEAD_PERIOD: Record<string, string> = {
  '1M': 'in the past month',
  '3M': 'in the past quarter',
  '6M': 'in the past six months',
  YTD: 'year to date',
  '1Y': 'in the trailing year',
  ALL: 'across all our history',
};

export function comparisonLabel(period: string): string {
  if (period === 'ALL') return 'all time';
  if (period === 'YTD') return 'vs prior YTD';
  return `vs prior ${period}`;
}

export function teamOf(scope: string): string | null {
  return scope.startsWith('team:') ? scope.slice(5) : null;
}

export function headlineScope(scope: string): string {
  const t = teamOf(scope);
  return t ? `the ${t} team` : 'we';
}

// ---------- hero-card delta styling ----------

export interface HeroCard {
  label: string;
  value: string;
  sub: string;
  deltaColor: string;
  deltaShadow: string;
  deltaText: string;
}

/**
 * Delta chip for a hero stat. Green (#39FF14) when improving, red (#FF3131) when
 * worsening, muted "—" when flat or when the period is ALL (deltas disabled).
 * `invert` flips the sense (used by Zero-NNA rate, where down is good).
 */
export function heroCard(
  label: string,
  value: string,
  delta: number,
  sub: string,
  invert: boolean,
  isAll: boolean
): HeroCard {
  const d = Math.round(delta);
  if (isAll || d === 0) {
    return { label, value, sub, deltaColor: '#a5a5b2', deltaShadow: 'none', deltaText: '—' };
  }
  const good = invert ? d < 0 : d > 0;
  return {
    label,
    value,
    sub,
    deltaColor: good ? '#39FF14' : '#FF3131',
    deltaShadow: good ? '0 0 10px rgba(57,255,20,0.35)' : '0 0 10px rgba(255,49,49,0.35)',
    deltaText: (d > 0 ? '+' : '-') + Math.abs(d) + '%',
  };
}

export function buildHeroCards(data: KpiDashboardData, period: string): HeroCard[] {
  const isAll = period === 'ALL';
  const hk = data.heroKpis;
  const comp = comparisonLabel(period);
  return [
    heroCard('Total interactions', fmtInt(hk.interactions.value), hk.interactions.deltaPercent, comp, false, isAll),
    heroCard('In-progress', fmtInt(hk.inProgress.value), hk.inProgress.deltaPercent, comp, false, isAll),
    heroCard('Total NNA', fmtCur(hk.nna.value), hk.nna.deltaPercent, comp, false, isAll),
    heroCard('NNA per interaction', fmtCur(hk.avgNnaPerInteraction.value), hk.avgNnaPerInteraction.deltaPercent, comp, false, isAll),
    heroCard('Completion rate', Math.round(hk.completionRate.value) + '%', hk.completionRate.deltaPercent, comp, false, isAll),
    heroCard('Zero-NNA rate', Math.round(hk.zeroNnaRate.value) + '%', hk.zeroNnaRate.deltaPercent, 'of completed', true, isAll),
  ];
}

// ---------- segment matrix: best-converting cell (Q9) ----------

export interface BestCell {
  t: string;
  d: string;
  hitRate: number;
  medianNna: number;
}

export function findBestCell(matrix: SegmentMatrix): BestCell | null {
  let best: BestCell | null = null;
  for (const t of matrix.types) {
    for (const d of matrix.depts) {
      const c = matrix.cells[`${t}|${d}`];
      if (!c) continue;
      if (!best || c.hitRate > best.hitRate) best = { t, d, hitRate: c.hitRate, medianNna: c.medianNna };
    }
  }
  return best;
}

// ---------- verdict sentences (one per question) ----------

const DASH = '—'; // em dash

export function verdictQ1(data: KpiDashboardData, scope: string, period: string): string {
  const isAll = period === 'ALL';
  const hk = data.heroKpis;
  const t = teamOf(scope);
  const dInt = Math.round(hk.interactions.deltaPercent);
  const scopeSubj = t ? `The ${t} team logged ` : 'We logged ';
  const trend = isAll
    ? ''
    : ` ${DASH} ${dInt > 0 ? `up ${dInt}%` : dInt < 0 ? `down ${Math.abs(dInt)}%` : 'flat'} on the prior period`;
  return `${scopeSubj}${fmtInt(hk.interactions.value)} engagements ${HEAD_PERIOD[period]}${trend}, producing ${fmtCur(hk.nna.value)} in net new assets.`;
}

export function verdictFlow(data: KpiDashboardData): string {
  const wf = data.extended.weeklyFlow;
  const opened13 = wf.slice(13).reduce((s, w) => s + w.opened, 0);
  const done13 = wf.slice(13).reduce((s, w) => s + w.completed, 0);
  return opened13 > done13
    ? `Intake. We opened ${opened13} items in the last 13 weeks but completed ${done13} ${DASH} the backlog is growing because volume rose, not because delivery slowed.`
    : `Neither ${DASH} delivery is keeping pace. ${done13} completed against ${opened13} opened over the last 13 weeks.`;
}

export function verdictMix(data: KpiDashboardData): string {
  const md = data.extended.mixDrift;
  if (!md.length) return '';
  const drift = md[md.length - 1].lowPct - md[0].lowPct;
  if (Math.abs(drift) < 4) return 'No. The split between high-touch work and data tasks has been stable across the year.';
  return drift > 0
    ? `Somewhat ${DASH} data tasks are up ${Math.round(drift)} points of share over 12 months.`
    : `The opposite ${DASH} high-touch work gained ${Math.round(-drift)} points of share over 12 months.`;
}

export function verdictQ4(data: KpiDashboardData): string {
  const ct = data.extended.cycleTimes;
  const slowest = ct[0];
  const fastest = ct[ct.length - 1];
  if (!slowest || !fastest) return '';
  return `Typical turnaround runs ${Math.round(fastest.median)}${DASH}${Math.round(slowest.median)} days by type. ${slowest.type} is slowest at a ${Math.round(slowest.median)}-day median; the P90 tail reaches ${Math.round(slowest.p90)} days.`;
}

export function verdictQ5(data: KpiDashboardData): string {
  const stale = data.staleEngagements;
  return stale.length
    ? `These have been open longer than 3 weeks. The oldest has sat for ${stale[0].daysOpen} days ${DASH} worth a check-in.`
    : `Nothing stale ${DASH} nice.`;
}

export function verdictQ6(data: KpiDashboardData): string {
  const depts = data.clientDepts;
  const topVol = depts[0];
  const topEff = [...depts].sort((a, b) => b.nnaPerInteraction - a.nnaPerInteraction)[0];
  if (!topVol || !topEff) return '';
  return `${topVol.dept} drives the most volume (${fmtInt(topVol.interactions)} interactions), but ${topEff.dept} is the most efficient at ${fmtCur(topEff.nnaPerInteraction)} per engagement. Toggle the metric to compare.`;
}

export function subtitleConc(data: KpiDashboardData): string {
  const conc = data.nnaConcentration;
  return conc.clients.length
    ? `Top ${conc.clientsForEightyPercent} clients account for 80% of NNA. The top five alone hold ${Math.round(conc.top5Share)}% ${DASH} classic Pareto concentration.`
    : 'No NNA data yet.';
}

export function verdictQ8(data: KpiDashboardData): string {
  const top = data.extended.chainRolled.find(r => r.downstream > 0);
  return top
    ? `${top.type} work originates ${fmtCur(top.rolledNna)} once the chains it starts are rolled up ${DASH} ${Math.round(top.uplift)}% more than its direct NNA alone.`
    : 'Little downstream value is currently attributable through chains.';
}

export function verdictQ9(data: KpiDashboardData): string {
  const best = findBestCell(data.extended.segmentMatrix);
  return best
    ? `${best.t} for ${best.d} converts best ${DASH} ${Math.round(best.hitRate)}% of completed work lands NNA, at a median of ${fmtCur(best.medianNna)}.`
    : '';
}

export function verdictQ10(data: KpiDashboardData): string {
  const chase = data.extended.chaseList;
  return chase.length
    ? `${chase.length}+ engagements were completed over a month ago with no NNA recorded. Until someone chases these, our value numbers understate reality.`
    : `None ${DASH} every completed engagement has a recorded outcome.`;
}

export function verdictQ12(data: KpiDashboardData): string {
  const top = data.extended.spawnRate[0];
  return top
    ? `Yes ${DASH} ${Math.round(top.pct)}% of ${top.type.toLowerCase()}s spawn follow-up work, the highest of any type.`
    : '';
}

export function verdictQ13(data: KpiDashboardData): string {
  const totNew = data.extended.clientBase.reduce((s, b) => s + b.newN, 0);
  return totNew > 8
    ? `Growing ${DASH} ${totNew} first-time clients engaged us in the last 12 months on top of the recurring base.`
    : `Mostly recycling ${DASH} only ${totNew} first-time clients in the last 12 months; the rest is repeat business.`;
}

export function verdictQ14(data: KpiDashboardData): string {
  const dormant = data.dormantClients;
  return dormant.length
    ? `${dormant.length} clients with 3+ historical engagements have been silent for 60+ days.`
    : `No dormant clients ${DASH} everyone we’ve worked with is still active.`;
}
