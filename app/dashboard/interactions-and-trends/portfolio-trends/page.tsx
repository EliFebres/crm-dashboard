'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Building2, DollarSign, Landmark, Layers, MapPin, PieChart, Users } from 'lucide-react';
import AssetClassFilterButton, { type EquityScope } from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/AssetClassFilterButton';
import RequiresMarketData from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/RequiresMarketData';
import DashboardHeader from '@/app/components/dashboard/shared/DashboardHeader';
import { getPortfolioTrends } from '@/app/lib/api/portfolio-trends';
import { AVG_CLIENT } from '@/app/lib/types/portfolioTrends';
import type { PortfolioTrendsResponse } from '@/app/lib/types/portfolioTrends';

// Every number on this page comes from portfolio.sqlite (see app/lib/db/portfolioTrends.ts),
// which is refreshed by `npm run sync:portfolio`. That store holds identifiers, asset class,
// constituent type and weight — and no market data. The style, profitability, benchmark and
// fixed-income cards therefore render an explicit "requires market data" state instead of
// inventing numbers; they light back up when a security master populates
// PortfolioTrendsResponse.marketData.

const ALL_TEAMS = 'All Teams';
const ALL_DEPARTMENTS = 'All Departments';
const ALL_OFFICES = 'All Offices';
const ANY_AUM = 'Any AUM';

// AUM is a strict lower bound in dollars. Models whose AUM was never entered match no
// threshold at all — the strip surfaces how many were dropped so the exclusion isn't silent.
const AUM_THRESHOLDS: Record<string, number | null> = {
  [ANY_AUM]: null,
  '$10M+': 10_000_000,
  '$100M+': 100_000_000,
  '$250M+': 250_000_000,
  '$500M+': 500_000_000,
  '$1B+': 1_000_000_000,
};
const AUM_OPTIONS = Object.keys(AUM_THRESHOLDS);

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

/**
 * A card whose chart is waiting on a security master. The shell — border, gradient, title,
 * sizing — matches the live cards exactly, so each chart drops back into place with no
 * re-layout once `marketData` is non-null.
 */
function MarketDataCard({
  title,
  subtitle,
  needs,
  className,
}: {
  title: string;
  subtitle: string;
  needs: string[];
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl min-h-[340px] flex flex-col ${className ?? ''}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 flex flex-col flex-1">
        <div className="mb-4 -mt-2 -ml-2">
          <h4 className="text-sm font-medium text-white">{title}</h4>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        <RequiresMarketData needs={needs} />
      </div>
    </div>
  );
}

export default function PortfolioTrendsDashboard() {
  // Filter state. Unlike the previous mock build, every one of these reaches the query.
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [officeFilter, setOfficeFilter] = useState<string[]>([]);
  const [aumFilter, setAumFilter] = useState(ANY_AUM);
  const [portfolioFilter, setPortfolioFilterRaw] = useState<string[]>([AVG_CLIENT]);

  const quarterEndOptions = useMemo(() => getRecentQuarterEnds(8), []);
  const [period, setPeriod] = useState(quarterEndOptions[0]);

  const [trends, setTrends] = useState<PortfolioTrendsResponse | null>(null);

  const minAum = AUM_THRESHOLDS[aumFilter] ?? null;

  useEffect(() => {
    let cancelled = false;
    getPortfolioTrends({
      departments: departmentFilter,
      offices: officeFilter,
      teams: teamFilter === ALL_TEAMS ? [] : [teamFilter],
      cohorts: portfolioFilter,
      minAum,
    })
      .then(res => { if (!cancelled) setTrends(res); })
      .catch(() => { if (!cancelled) setTrends(null); });
    return () => { cancelled = true; };
  }, [departmentFilter, officeFilter, teamFilter, portfolioFilter, minAum]);

  // Asset class filter — independent radio (equity scope) + checkbox (fixed income),
  // with a hard floor that at least one bucket is always active. Floor enforcement
  // also lives inside AssetClassFilterButton's click handlers; the setter wrappers
  // here are a defense-in-depth in case any caller bypasses the component handlers.
  const [equityScope, setEquityScopeRaw] = useState<EquityScope | null>('Total');
  const [fixedIncomeOn, setFixedIncomeOnRaw] = useState(true);
  // Hold onto the last non-null equity scope so the heading keeps its prefix while the
  // equity section is mid-exit-animation (where equityScope itself is already null).
  // Recorded here in the setter rather than in an effect, so nothing reads it mid-render.
  const [lastEquityScope, setLastEquityScope] = useState<EquityScope>('Total');
  const setEquityScope = (next: EquityScope | null) => {
    if (next === null && !fixedIncomeOn) setFixedIncomeOnRaw(true);
    if (next !== null) setLastEquityScope(next);
    setEquityScopeRaw(next);
  };
  const setFixedIncomeOn = (next: boolean) => {
    if (!next && equityScope === null) setEquityScopeRaw('Total');
    setFixedIncomeOnRaw(next);
  };
  const equityVisibility = useSectionVisibility(equityScope !== null);
  const fixedIncomeVisibility = useSectionVisibility(fixedIncomeOn);
  const titleEquityScope: EquityScope = equityScope ?? lastEquityScope;

  // Always keep at least one cohort selected — snap back to Avg. Client on empty.
  const setPortfolioFilter = (next: string[]) => {
    setPortfolioFilterRaw(next.length === 0 ? [AVG_CLIENT] : next);
  };

  const options = trends?.filterOptions;
  const cohortOptions = options?.cohorts.length ? options.cohorts.map(c => c.name) : [AVG_CLIENT];

  const dataMetrics = useMemo(() => {
    const s = trends?.summary;
    const n = (v: number | undefined) => (v == null ? '—' : v.toLocaleString());
    return [
      { label: 'Unique Clients', value: n(s?.uniqueClients) },
      { label: 'Models Logged', value: n(s?.modelsLogged) },
      { label: 'Equity Models', value: n(s?.equityModels) },
      { label: 'F.I. Models', value: n(s?.fixedIncomeModels) },
      { label: 'Avg Positions', value: n(s?.avgPositions) },
      { label: 'Recent Updates', value: s ? `${s.recentUpdatesPct}%` : '—' },
    ];
  }, [trends]);

  // A model with no AUM satisfies no threshold. Say so, rather than letting it read as
  // "nothing matched".
  const excludedByAum = minAum != null ? trends?.summary.modelsWithoutAum ?? 0 : 0;

  return (
    <>
        {/* Top Bar with Filters */}
        <DashboardHeader
          title="Portfolio Trends"
          subtitle="Compare client portfolio characteristics against benchmarks"
          searchPlaceholder=""
          searchValue=""
          onSearchChange={() => {}}
          filters={[
            {
              id: 'team',
              icon: Users,
              label: 'Teams',
              options: [ALL_TEAMS, ...(options?.teams ?? [])],
              value: teamFilter,
              onChange: (v: string | string[]) => setTeamFilter(v as string),
            },
            {
              id: 'department',
              icon: Building2,
              label: 'Department',
              options: [ALL_DEPARTMENTS, ...(options?.departments ?? [])],
              value: departmentFilter,
              onChange: (v: string | string[]) => setDepartmentFilter(v as string[]),
              multiSelect: true,
            },
            {
              id: 'office',
              icon: MapPin,
              label: 'Office',
              options: [ALL_OFFICES, ...(options?.offices ?? [])],
              value: officeFilter,
              onChange: (v: string | string[]) => setOfficeFilter(v as string[]),
              multiSelect: true,
            },
            {
              id: 'aum',
              icon: DollarSign,
              label: 'AUM',
              options: AUM_OPTIONS,
              value: aumFilter,
              onChange: (v: string | string[]) => setAumFilter(v as string),
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
              options: cohortOptions,
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
              style={{ gridTemplateColumns: `10% repeat(${dataMetrics.length}, minmax(0, 1fr))` }}
            >
              <span className="text-[10px] uppercase tracking-wider text-muted font-medium">
                Data Metrics
              </span>
              {dataMetrics.map((s) => (
                <div key={s.label} className="flex items-baseline justify-center gap-2 min-w-0">
                  <span className="text-sm font-mono font-semibold text-zinc-200 flex-shrink-0">{s.value}</span>
                  <span className="text-[11px] text-muted truncate">{s.label}</span>
                </div>
              ))}
            </div>
            {excludedByAum > 0 && (
              <p className="mt-2 text-[11px] text-zinc-500">
                {excludedByAum.toLocaleString()} model{excludedByAum === 1 ? '' : 's'} excluded — no AUM recorded.
              </p>
            )}
          </div>

          {/* ==================== SECTION 1: PORTFOLIO CONSTRUCTION ==================== */}
          {equityVisibility !== 'hidden' && (
          <div className={equityVisibility === 'exiting' ? 'section-exit' : undefined}>
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-white">{titleEquityScope} Equity Portfolio Trends</h3>
              <span className="text-xs text-muted ml-2">Style, quality, and regional positioning vs benchmark</span>
            </div>

            {/*
              When marketData lands, both scatters render one translucent circle per model in
              the current filter (all models when unfiltered), with the selected cohort's
              aggregate drawn as a solid dot on top — so the spread of individual models is
              visible behind the average.
            */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <MarketDataCard
                title="Style XY"
                subtitle={`vs MSCI ACWI IMI (${period})`}
                needs={['weighted-average market cap', 'price-to-book']}
              />
              <MarketDataCard
                title="Profitability XY"
                subtitle={`vs MSCI ACWI IMI (${period})`}
                needs={['price-to-book', 'weighted-average profitability']}
              />
              <MarketDataCard
                title="Metrics vs Index"
                subtitle={`vs MSCI ACWI IMI (${period})`}
                needs={['underlying company counts', 'market cap', 'price-to-book', 'profitability']}
              />
            </div>

            <div className="grid grid-cols-3 gap-4 row-stagger-2">
              <MarketDataCard
                title="vs MSCI ACWI IMI"
                subtitle={`Regional equity positioning (${period})`}
                needs={['US, developed ex-US and emerging-market equity allocations']}
              />
              <MarketDataCard
                title="Style × Profitability"
                subtitle={`Cap and style allocation (${period})`}
                needs={['market-cap size buckets', 'growth vs value split', 'profitability buckets']}
                className="col-span-2"
              />
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

            <div className="grid grid-cols-3 gap-4 mb-4 row-stagger-3">
              <MarketDataCard
                title="FI Metrics"
                subtitle={`vs Bloomberg US Aggregate (${period})`}
                needs={['effective duration', 'effective maturity', 'yield to maturity', 'SEC yield']}
              />
              <MarketDataCard
                title="Yield Curve"
                subtitle={`Treasury par yields (${period})`}
                needs={['Treasury yields by tenor', 'per-model effective duration']}
                className="col-span-2"
              />
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4 row-stagger-4">
              <MarketDataCard
                title="Credit Breakdown"
                subtitle={`vs Bloomberg US Aggregate (${period})`}
                needs={['credit ratings per holding']}
              />
              <MarketDataCard
                title="Credit Spread"
                subtitle={`Credit − Gov Index (${period})`}
                needs={['credit spreads in bps', 'credit vs government weight history']}
                className="col-span-2"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 mb-4 row-stagger-5">
              <MarketDataCard
                title="Security Type"
                subtitle={`vs Bloomberg US Aggregate (${period})`}
                needs={['instrument type per holding (government, municipal, corporate, securitized)']}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 row-stagger-6">
              <MarketDataCard
                title="Maturity Breakdown"
                subtitle={`vs Bloomberg US Aggregate (${period})`}
                needs={['maturity date per holding']}
              />
            </div>
          </div>
          )}
        </div>
    </>
  );
}
