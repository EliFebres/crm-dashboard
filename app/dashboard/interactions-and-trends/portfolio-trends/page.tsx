'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Building2, DollarSign, Landmark, Layers, MapPin, PieChart, Users } from 'lucide-react';
import AssetClassFilterButton, { type EquityScope } from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/AssetClassFilterButton';
import BenchmarkBarChart from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/BenchmarkBarChart';
import CharacteristicScatter from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/CharacteristicScatter';
import CreditSpreadChart from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/CreditSpreadChart';
import MetricsTable, { type MetricSpec } from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/MetricsTable';
import RequiresMarketData from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/RequiresMarketData';
import StyleBoxCard from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/StyleBoxCard';
import YieldCurveChart from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/YieldCurveChart';
import { SERIES_PALETTE, stableCohortOrder } from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/chartTokens';
import { hasData, toGroups, useDisplayedSeries, yMaxFor } from '@/app/components/dashboard/interactions-and-trends/portfolio-trends/breakdownAdapter';
import DashboardHeader from '@/app/components/dashboard/shared/DashboardHeader';
import { getPortfolioTrends } from '@/app/lib/api/portfolio-trends';
import { AVG_CLIENT, EQUITY_SCOPE_SLEEVE } from '@/app/lib/types/portfolioTrends';
import type {
  BreakdownSeries,
  PortfolioTrendsResponse,
  SleeveMarketData,
} from '@/app/lib/types/portfolioTrends';

// Every number on this page comes from portfolio.sqlite. Model rows and holdings are
// refreshed by `npm run sync:portfolio`; the analytics behind the charts — characteristics,
// breakdowns, the Treasury curve, credit spreads — are uploaded by backend/portfolio_data
// into the pf_* tables in the same file. A card whose slice has not been uploaded keeps the
// explicit "requires market data" state rather than drawing an empty plot, so "not ingested"
// stays distinguishable from "ingested, and the answer is zero".

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

// Returns the N most recent completed quarter-end ISO dates. Used only as a fallback for
// the period dropdown before any analytics exist — once they do, the options come from the
// periods that actually hold data (filterOptions.periods), because offering a quarter with
// nothing in it renders every card empty and reads as a bug.
function getRecentQuarterEnds(count: number): string[] {
  const now = new Date();
  let q = Math.floor(now.getMonth() / 3) + 1; // 1-4 for current (in-progress) quarter
  let y = now.getFullYear();
  // Step back to the most recent completed quarter
  q -= 1;
  if (q === 0) { q = 4; y -= 1; }

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const month = q * 3;
    const lastDay = new Date(y, month, 0).getDate();
    result.push(`${y}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`);
    q -= 1;
    if (q === 0) { q = 4; y -= 1; }
  }
  return result;
}

/** '2026-03-31' → 'Q1 2026'. The label the period dropdown shows. */
function quarterLabel(iso: string): string {
  const [y, m] = iso.split('-');
  const quarter = Math.floor((Number(m) - 1) / 3) + 1;
  return `Q${quarter} ${y}`;
}

/**
 * A card whose chart is waiting on an analytics upload. The shell — border, gradient,
 * title, sizing — matches the live cards exactly, so each chart drops back into place with
 * no re-layout once the data lands.
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
    <Card title={title} subtitle={subtitle} className={className}>
      <RequiresMarketData needs={needs} />
    </Card>
  );
}

/** The shared card shell. Same chrome for a live chart and for a pending one. */
function Card({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl min-h-[340px] flex flex-col ${className ?? ''}`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative z-10 flex flex-col flex-1 min-h-0">
        <div className="mb-4 -mt-2 -ml-2">
          <h4 className="text-sm font-medium text-white">{title}</h4>
          <p className="text-xs text-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

const EQUITY_METRICS: MetricSpec[] = [
  { key: 'underlyingCompanies', label: 'Number of Companies', format: 'count' },
  { key: 'wtdAvgMarketCap', label: 'Wtd avg mkt cap', format: 'money' },
  { key: 'priceToBook', label: 'Price/Book', format: 'ratio' },
  // Profitability is a bare ratio (gross profits / assets), not a percentage. It runs
  // roughly 0.00–5.00 with most clients between 0.20 and 0.60, so it is shown as the
  // number it is — rendering 0.29 as "29.0%" invited reading it as a share of something.
  { key: 'profitability', label: 'Profitability', format: 'ratio' },
];

const FI_METRICS: MetricSpec[] = [
  { key: 'effectiveDuration', label: 'Eff. duration', format: 'years' },
  { key: 'effectiveMaturity', label: 'Eff. maturity', format: 'years' },
  { key: 'yieldToMaturity', label: 'Yield to maturity', format: 'percent' },
  { key: 'secYield', label: 'SEC yield', format: 'percent' },
];

export default function PortfolioTrendsDashboard() {
  // Filter state. Unlike the previous mock build, every one of these reaches the query.
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [officeFilter, setOfficeFilter] = useState<string[]>([]);
  const [aumFilter, setAumFilter] = useState(ANY_AUM);
  const [portfolioFilter, setPortfolioFilterRaw] = useState<string[]>([AVG_CLIENT]);

  // The selected period, as an ISO quarter end. Null means "whatever the server resolves
  // to" — on first load we don't yet know which periods hold data.
  const [asOf, setAsOf] = useState<string | null>(null);

  // Holds the last *successful* response. Deliberately not cleared when a refetch starts,
  // so changing a filter dims the current view rather than flashing an empty page — and
  // not cleared on error either, since a failed refresh should leave the last good numbers
  // on screen instead of blanking the dashboard.
  const [trends, setTrends] = useState<PortfolioTrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const minAum = AUM_THRESHOLDS[aumFilter] ?? null;

  // Asset class filter — independent radio (equity scope) + checkbox (fixed income),
  // with a hard floor that at least one bucket is always active. Floor enforcement
  // also lives inside AssetClassFilterButton's click handlers; the setter wrappers
  // here are a defense-in-depth in case any caller bypasses the component handlers.
  //
  // Declared above the fetch because the equity scope selects which sleeve the query
  // reads, so it belongs in that effect's dependency list.
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
  // Keep reading the last-held scope while the section animates out, so deselecting
  // equity doesn't fire an extra fetch for a different sleeve on the way to hiding it.
  const activeEquityScope: EquityScope = equityScope ?? lastEquityScope;
  const equitySleeve = EQUITY_SCOPE_SLEEVE[activeEquityScope];

  useEffect(() => {
    let cancelled = false;
    // Marking the in-flight fetch is the effect synchronizing React with an external
    // system, which is exactly what the rule carves out — but it can't tell the shape
    // apart from a cascading-render bug, so the suppression is explicit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getPortfolioTrends({
      departments: departmentFilter,
      offices: officeFilter,
      teams: teamFilter === ALL_TEAMS ? [] : [teamFilter],
      cohorts: portfolioFilter,
      minAum,
      asOf,
      equitySleeve,
    })
      .then(res => {
        if (cancelled) return;
        setTrends(res);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [departmentFilter, officeFilter, teamFilter, portfolioFilter, minAum, asOf, equitySleeve]);

  const equityVisibility = useSectionVisibility(equityScope !== null);
  const fixedIncomeVisibility = useSectionVisibility(fixedIncomeOn);
  const titleEquityScope: EquityScope = activeEquityScope;

  // Always keep at least one cohort selected — snap back to Avg. Client on empty.
  const setPortfolioFilter = (next: string[]) => {
    setPortfolioFilterRaw(next.length === 0 ? [AVG_CLIENT] : next);
  };

  const view = trends;
  const options = view?.filterOptions;
  const cohortOptions = useMemo(
    () => (options?.cohorts.length ? options.cohorts.map(c => c.name) : [AVG_CLIENT]),
    [options]
  );
  const market = view?.marketData ?? null;

  // Palette slots key off this stable order, so deselecting a cohort never repaints the
  // ones that remain.
  const allCohorts = useMemo(() => stableCohortOrder(cohortOptions), [cohortOptions]);
  const displayedSeries = useDisplayedSeries(portfolioFilter, allCohorts);

  // Period options come from what was actually uploaded; the calendar is only a fallback
  // for a database with no analytics at all (where every card is a placeholder anyway).
  const periodIsos = options?.periods?.length ? options.periods : getRecentQuarterEnds(8);
  const periodLabels = useMemo(() => periodIsos.map(quarterLabel), [periodIsos]);
  const activeIso = market?.asOf ?? asOf ?? periodIsos[0] ?? '';
  const activeLabel = activeIso ? quarterLabel(activeIso) : '';

  // The strip describes the dataset in scope, so it follows the department / office /
  // team / AUM filters but not the Portfolios one — that picks which averages the charts
  // draw, not which models exist. Each entry carries a `hint` because none of these
  // labels says what it measures: "F.I. Models" could as easily mean "models containing
  // any bonds" as "models that are mostly bonds", and the two differ a lot.
  const dataMetrics = useMemo(() => {
    const s = view?.summary;
    const n = (v: number | undefined) => (v == null ? '—' : v.toLocaleString());
    return [
      {
        label: 'Unique Clients', value: n(s?.uniqueClients),
        hint: 'Distinct external clients with a logged model, in the current scope.',
      },
      {
        label: 'Models Logged', value: n(s?.modelsLogged),
        hint: 'Models in the current scope. Not affected by the Portfolios filter, which selects chart series rather than data.',
      },
      {
        label: 'Equity Models', value: n(s?.equityModels),
        hint: 'Models with at least half their weight in Equity.',
      },
      {
        label: 'F.I. Models', value: n(s?.fixedIncomeModels),
        hint: 'Models with at least half their weight in Fixed Income. Equity and F.I. are independent counts — a model that is mostly alternatives or cash is in neither, so they need not add up to Models Logged.',
      },
      {
        label: 'Avg Positions', value: n(s?.avgPositions),
        hint: 'Mean number of holdings per model, over models that hold any.',
      },
      {
        label: 'Recent Updates', value: s ? `${s.recentUpdatesPct}%` : '—',
        hint: 'Share of models logged or changed in the last 30 days.',
      },
    ];
  }, [view]);

  // A model with no AUM satisfies no threshold. Say so, rather than letting it read as
  // "nothing matched".
  const excludedByAum = minAum != null ? view?.summary.modelsWithoutAum ?? 0 : 0;

  const equity: SleeveMarketData | null = market?.equity ?? null;
  const fixedIncome: SleeveMarketData | null = market?.fixedIncome ?? null;

  // The index for the scoped sleeve — Russell 3000 for US, MSCI World ex USA IMI for
  // Developed, MSCI EM IMI for Emerging Markets, MSCI ACWI IMI for the whole book. The
  // fallbacks only show before the first response lands.
  const SCOPE_INDEX_FALLBACK: Record<EquityScope, string> = {
    Total: 'MSCI ACWI IMI',
    US: 'Russell 3000 Index',
    Developed: 'MSCI World ex USA IMI Index',
    'Emerging Markets': 'MSCI Emerging Markets IMI Index',
  };
  const equityIndexName = equity?.benchmark?.ref.name ?? SCOPE_INDEX_FALLBACK[titleEquityScope];
  // The regional split is always the whole book against the all-country index, whatever
  // the scope — see `equityRegions` on the response type.
  const regionIndexName = market?.equityRegionsBenchmark?.name ?? 'MSCI ACWI IMI';
  const fiIndexName = fixedIncome?.benchmark?.ref.name ?? 'Bloomberg US Aggregate';

  /** One grouped-bar card, or its placeholder when the dimension was never uploaded. */
  const breakdownCard = (
    series: BreakdownSeries | undefined,
    title: string,
    subtitle: string,
    needs: string[],
    indexName: string,
    className?: string,
    staggerDelayMs = 0,
  ) => {
    if (!hasData(series, portfolioFilter)) {
      return <MarketDataCard title={title} subtitle={subtitle} needs={needs} className={className} />;
    }
    const groups = toGroups(series, portfolioFilter);
    return (
      <Card title={title} subtitle={subtitle} className={className}>
        <div className="flex-1 min-h-0">
          <BenchmarkBarChart
            data={groups}
            displayedSeries={displayedSeries}
            palette={SERIES_PALETTE}
            benchmarkLabel={indexName}
            showBenchmark={series?.benchmark != null}
            yMax={yMaxFor(groups)}
            staggerDelayMs={staggerDelayMs}
          />
        </div>
      </Card>
    );
  };

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
          period={activeLabel}
          onPeriodChange={(label: string) => {
            const idx = periodLabels.indexOf(label);
            if (idx >= 0) setAsOf(periodIsos[idx]);
          }}
          periodOptions={periodLabels}
          className="sticky top-0 z-10"
          alwaysShowFilters
        />

        <div className={`p-6 space-y-6 transition-opacity duration-200 ${loading && view ? 'opacity-60' : ''}`}>
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
                <div
                  key={s.label}
                  className="flex items-baseline justify-center gap-2 min-w-0"
                  title={`${s.label} — ${s.hint}`}
                >
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
            {/* The requested period and the one actually shown can differ when an upload
                lags a quarter. Saying so beats silently swapping the period out. */}
            {market && asOf && market.asOf !== asOf && (
              <p className="mt-2 text-[11px] text-amber-400/80">
                No analytics for {quarterLabel(asOf)} — showing {quarterLabel(market.asOf)}, the
                most recent period with data.
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

            <div className="grid grid-cols-3 gap-4 mb-4">
              {equity && equity.cohorts.length > 0 ? (
                <Card title="Style XY" subtitle={`vs ${equityIndexName} (${activeLabel})`}>
                  <CharacteristicScatter
                    models={equity.models}
                    cohorts={equity.cohorts}
                    benchmark={equity.benchmark}
                    allCohorts={allCohorts}
                    xMetric="priceToBook"
                    yMetric="wtdAvgMarketCap"
                    xLabel="Price/Book"
                    yLabel="Wtd avg market cap"
                    xFormat="ratio"
                    yFormat="money"
                  />
                </Card>
              ) : (
                <MarketDataCard
                  title="Style XY"
                  subtitle={`vs ${equityIndexName} (${activeLabel})`}
                  needs={['weighted-average market cap', 'price-to-book']}
                />
              )}

              {equity && equity.cohorts.length > 0 ? (
                <Card title="Profitability XY" subtitle={`vs ${equityIndexName} (${activeLabel})`}>
                  <CharacteristicScatter
                    models={equity.models}
                    cohorts={equity.cohorts}
                    benchmark={equity.benchmark}
                    allCohorts={allCohorts}
                    xMetric="priceToBook"
                    yMetric="profitability"
                    xLabel="Price/Book"
                    yLabel="Profitability"
                    xFormat="ratio"
                    // A bare number, not a percentage — see EQUITY_METRICS.
                    yFormat="ratio"
                  />
                </Card>
              ) : (
                <MarketDataCard
                  title="Profitability XY"
                  subtitle={`vs ${equityIndexName} (${activeLabel})`}
                  needs={['price-to-book', 'weighted-average profitability']}
                />
              )}

              {equity && equity.cohorts.length > 0 ? (
                <Card title="Metrics vs Index" subtitle={`vs ${equityIndexName} (${activeLabel})`}>
                  <MetricsTable
                    metrics={EQUITY_METRICS}
                    cohorts={equity.cohorts}
                    benchmark={equity.benchmark}
                    allCohorts={allCohorts}
                  />
                </Card>
              ) : (
                <MarketDataCard
                  title="Metrics vs Index"
                  subtitle={`vs ${equityIndexName} (${activeLabel})`}
                  needs={['underlying company counts', 'market cap', 'price-to-book', 'profitability']}
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 row-stagger-2">
              {/* Always the whole equity book, even under a regional scope: a US sleeve's
                  own regional split is trivially 100% US. Benchmarked against the
                  all-country index, since a single-region index has no split to compare. */}
              {breakdownCard(
                market?.equityRegions ?? undefined,
                `vs ${regionIndexName}`, `Regional equity positioning (${activeLabel})`,
                ['US, developed ex-US and emerging-market equity allocations'],
                regionIndexName, undefined, 400,
              )}

              {/* Morningstar style box beside the allocation it comes from. The box shows
                  position at a glance; the table carries the figures it abstracts away,
                  including how many names hold each weight. */}
              {equity && (hasData(equity.breakdowns['market_cap'], portfolioFilter)
                || hasData(equity.breakdowns['style'], portfolioFilter)) ? (
                <Card
                  title="Style × Profitability"
                  subtitle={`Cap and style allocation (${activeLabel})`}
                  className="col-span-2"
                >
                  <StyleBoxCard
                    marketCap={equity.breakdowns['market_cap']}
                    style={equity.breakdowns['style']}
                    models={equity.modelBreakdowns}
                    cohorts={portfolioFilter}
                    allCohorts={allCohorts}
                    benchmarkName={equityIndexName}
                  />
                </Card>
              ) : (
                <MarketDataCard
                  title="Style × Profitability"
                  subtitle={`Cap and style allocation (${activeLabel})`}
                  needs={['market-cap size buckets', 'growth vs value split', 'holding counts per bucket']}
                  className="col-span-2"
                />
              )}
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
              {fixedIncome && fixedIncome.cohorts.length > 0 ? (
                <Card title="FI Metrics" subtitle={`vs ${fiIndexName} (${activeLabel})`}>
                  <MetricsTable
                    metrics={FI_METRICS}
                    cohorts={fixedIncome.cohorts}
                    benchmark={fixedIncome.benchmark}
                    allCohorts={allCohorts}
                  />
                </Card>
              ) : (
                <MarketDataCard
                  title="FI Metrics"
                  subtitle={`vs ${fiIndexName} (${activeLabel})`}
                  needs={['effective duration', 'effective maturity', 'yield to maturity', 'SEC yield']}
                />
              )}

              {market && market.yieldCurve.length > 0 ? (
                <Card
                  title="Yield Curve"
                  subtitle={`Treasury par yields (${activeLabel})`}
                  className="col-span-2"
                >
                  <YieldCurveChart
                    curve={market.yieldCurve}
                    cohorts={fixedIncome?.cohorts ?? []}
                    benchmark={fixedIncome?.benchmark ?? null}
                    allCohorts={allCohorts}
                  />
                </Card>
              ) : (
                <MarketDataCard
                  title="Yield Curve"
                  subtitle={`Treasury par yields (${activeLabel})`}
                  needs={['Treasury yields by tenor', 'per-model effective duration']}
                  className="col-span-2"
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4 row-stagger-4">
              {breakdownCard(
                fixedIncome?.breakdowns['credit_rating'],
                'Credit Breakdown', `vs ${fiIndexName} (${activeLabel})`,
                ['credit ratings per holding'],
                fiIndexName, undefined, 600,
              )}

              {market && market.creditSpreads.length > 0 ? (
                <Card
                  title="Credit Spread"
                  subtitle={`Credit − Gov Index (${activeLabel})`}
                  className="col-span-2"
                >
                  <CreditSpreadChart points={market.creditSpreads} />
                </Card>
              ) : (
                <MarketDataCard
                  title="Credit Spread"
                  subtitle={`Credit − Gov Index (${activeLabel})`}
                  needs={['credit spreads in bps', 'credit vs government weight history']}
                  className="col-span-2"
                />
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 mb-4 row-stagger-5">
              {breakdownCard(
                fixedIncome?.breakdowns['security_type'],
                'Security Type', `vs ${fiIndexName} (${activeLabel})`,
                ['instrument type per holding (government, municipal, corporate, securitized)'],
                fiIndexName, undefined, 800,
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 row-stagger-6">
              {breakdownCard(
                fixedIncome?.breakdowns['maturity_band'],
                'Maturity Breakdown', `vs ${fiIndexName} (${activeLabel})`,
                ['maturity date per holding'],
                fiIndexName, undefined, 1000,
              )}
            </div>
          </div>
          )}
        </div>
    </>
  );
}
