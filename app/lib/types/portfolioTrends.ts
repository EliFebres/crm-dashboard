/**
 * Shared Portfolio Trends contract.
 *
 * Kept free of any database import so the client bundle can use these types and the
 * AVG_CLIENT constant without pulling in better-sqlite3.
 */

/** The synthetic cohort: each client collapsed to its single main model. */
export const AVG_CLIENT = 'Avg. Client';

/** The portfolios a model is analysed as. Mirrors portfolio_data's sleeve vocabulary. */
export type Sleeve =
  | 'total'
  | 'equity'
  | 'equity_us'
  | 'equity_developed'
  | 'equity_em'
  | 'fixed_income';

/** The equity scope selector's options, in the order the filter lists them. */
export type EquityScopeKey = 'Total' | 'US' | 'Developed' | 'Emerging Markets';

/**
 * Which sleeve each equity scope reads.
 *
 * The regional sleeves are populated by an analytics upload, not derived here: a holding
 * carries no domicile, so splitting equity by region needs a security master. A scope with
 * nothing uploaded leaves its cards in the "requires market data" state.
 */
export const EQUITY_SCOPE_SLEEVE: Record<EquityScopeKey, Sleeve> = {
  Total: 'equity',
  US: 'equity_us',
  Developed: 'equity_developed',
  'Emerging Markets': 'equity_em',
};

export interface PortfolioTrendsFilters {
  departments?: string[];
  offices?: string[];
  teams?: string[];
  /** Model names, and/or AVG_CLIENT to mean "each client's main model". */
  cohorts?: string[];
  /** Strict lower bound in dollars. Models with a NULL aum never match. */
  minAum?: number | null;
  /**
   * Quarter end to read analytics at, as `YYYY-MM-DD`. Omitted means "the most recent
   * period that actually has data" — which is not the same as the most recent completed
   * quarter, since an upload can lag. The resolved value comes back as
   * `marketData.asOf` so the page can show which period it actually got.
   */
  asOf?: string | null;
  /**
   * Which equity sleeve the equity cards read — the Asset Class filter's scope selector.
   * Defaults to the whole equity book.
   */
  equitySleeve?: Sleeve | null;
}

/**
 * The Data Metrics strip. Describes the dataset in scope — the department, office, team
 * and AUM filters apply; the Portfolios (cohort) filter deliberately does not, because it
 * selects which series the charts plot rather than which models exist.
 */
export interface PortfolioTrendsSummary {
  /** Models in scope, however many holdings they carry. */
  modelsLogged: number;
  /** Distinct external clients behind those models. */
  uniqueClients: number;
  /**
   * Models with at least half their weight in Equity.
   *
   * `equityModels` and `fixedIncomeModels` are independent counts, not a partition: a
   * model that is mostly Alternatives, Crypto, Multi-Asset or Cash falls in neither, as
   * does one with no holdings, so they need not sum to `modelsLogged`. (A 50/50 model
   * reaches the threshold on both sides and is counted in each.)
   */
  equityModels: number;
  /** Models with at least half their weight in Fixed Income. See `equityModels`. */
  fixedIncomeModels: number;
  /** Mean positions per model, over models that hold any. */
  avgPositions: number;
  /** Share of models logged within the last 30 days. */
  recentUpdatesPct: number;
  /** Models excluded from any AUM threshold because their AUM was never entered. */
  modelsWithoutAum: number;
}

export interface PortfolioCohort {
  name: string;
  modelCount: number;
}

export interface PortfolioTrendsFilterOptions {
  departments: string[];
  offices: string[];
  teams: string[];
  cohorts: PortfolioCohort[];
  /**
   * Quarter ends that actually hold analytics, newest first. The period dropdown is
   * built from these rather than from the calendar: offering a quarter with no uploaded
   * data would render every card empty and look like a bug.
   */
  periods: string[];
}

// ---------------------------------------------------------------------------------
// Market data — populated from the pf_* tables written by backend/portfolio_data.
//
// Everything below is null or empty until an analytics upload lands. Cards check their
// own slice and fall back to the "requires market data" state individually, so a partial
// ingest (characteristics but no breakdowns, say) lights up what it can instead of
// blanking the page.
// ---------------------------------------------------------------------------------

/**
 * Portfolio characteristics, as decimal fractions where they are ratios — matching how
 * portfolio_data stores them. 8.4% is 0.084 here too; the formatters do the ×100.
 */
export interface Characteristics {
  wtdAvgMarketCap?: number;
  medianMarketCap?: number;
  priceToBook?: number;
  priceToEarnings?: number;
  priceToSales?: number;
  /**
   * Gross profits over assets — a bare ratio, NOT a percentage. Runs roughly 0.00–5.00,
   * with most clients between 0.20 and 0.60. Format it as `'ratio'`; multiplying by 100
   * would present 0.29 as "29%" and invite reading it as a share of something.
   */
  profitability?: number;
  dividendYield?: number;
  returnOnEquity?: number;
  underlyingCompanies?: number;
  effectiveDuration?: number;
  effectiveMaturity?: number;
  yieldToMaturity?: number;
  secYield?: number;
  avgCoupon?: number;
  avgCreditQuality?: string;
  numHoldings?: number;
  expenseRatio?: number;
  turnover?: number;
}

/**
 * One cohort's aggregate for a sleeve at a period.
 *
 * `modelCount` is how many models carried *any* analytics, and each metric is an equal-
 * weighted mean over the models that reported that specific metric. Equal-weighted, not
 * AUM-weighted, because AUM is frequently unrecorded (the summary strip counts how many)
 * and an AUM weighting that silently ignores those models would be worse than an honest
 * average. `metricCounts` exposes the denominator per metric so a number computed from
 * two models out of forty is not mistaken for a settled figure.
 */
export interface CohortAggregate {
  cohort: string;
  modelCount: number;
  characteristics: Characteristics;
  metricCounts: Record<string, number>;
}

/** One model's position on a scatter — the cloud behind a cohort average. */
export interface ModelPoint {
  modelId: string;
  clientName: string;
  modelName: string;
  isMain: boolean;
  characteristics: Characteristics;
}

/**
 * A weight distribution over ordered buckets, per cohort, against the benchmark.
 * `buckets` is the canonical order (worst-to-best credit, shortest-to-longest maturity),
 * so the chart never sorts by value and never reorders between renders.
 */
export interface BreakdownSeries {
  dimension: string;
  buckets: string[];
  /** cohort name -> bucket -> weight (0..1). Missing buckets mean zero. */
  cohorts: Record<string, Record<string, number>>;
  /** The benchmark's distribution over the same buckets, or null when not uploaded. */
  benchmark: Record<string, number> | null;
  /**
   * Holding counts behind those weights: cohort -> bucket -> number of names.
   *
   * A separate fact from the weight, not derivable from it — 40% of a book can be four
   * names or four hundred, and which it is separates a concentrated bet from an
   * index-like sleeve. Empty when the upload carried no counts. For a cohort spanning
   * several models this is the mean per model, matching how the weights are averaged.
   */
  cohortNames: Record<string, Record<string, number>>;
  /** The benchmark's holding counts over the same buckets, or null. */
  benchmarkNames: Record<string, number> | null;
}

export interface BenchmarkRef {
  id: string;
  name: string;
}

/**
 * One model's own bucket weights — the cloud behind a cohort average on the style box,
 * the same role the per-model dots play on the XY scatters.
 *
 * Carries only the dimensions a per-model mark is actually plotted from (see
 * MODEL_LEVEL_DIMENSIONS in app/lib/db/portfolioTrends.ts). Shipping every dimension for
 * every model would multiply the payload for data nothing draws.
 */
export interface ModelBreakdownPoint {
  modelId: string;
  clientName: string;
  modelName: string;
  isMain: boolean;
  /** dimension -> bucket -> weight (0..1). */
  weights: Record<string, Record<string, number>>;
}

/** Everything one sleeve contributes to the page. */
export interface SleeveMarketData {
  /** Aggregates for the cohorts currently selected, in selection order. */
  cohorts: CohortAggregate[];
  /** The reference index for this sleeve, or null when nothing was uploaded for it. */
  benchmark: (CohortAggregate & { ref: BenchmarkRef }) | null;
  /** Every model in the filtered set that has analytics — the scatter cloud. */
  models: ModelPoint[];
  /** Per-model bucket weights — the style box's equivalent of `models`. */
  modelBreakdowns: ModelBreakdownPoint[];
  /** dimension -> distribution. Absent dimensions simply were not uploaded. */
  breakdowns: Record<string, BreakdownSeries>;
}

/** One point on the Treasury par-yield curve. `yield` is a decimal fraction. */
export interface YieldCurvePoint {
  tenor: string;
  yield: number;
}

/** One date's credit spreads, in basis points. */
export interface CreditSpreadPoint {
  asOf: string;
  ig: number | null;
  hy: number | null;
}

export interface PortfolioMarketData {
  /** The period actually read — may lag the requested one when no data exists for it. */
  asOf: string;
  /** The scoped equity sleeve: the whole book, or one region of it. */
  equity: SleeveMarketData;
  /** Which sleeve `equity` holds, echoed back so the UI can label what it got. */
  equitySleeve: Sleeve;
  /**
   * Regional split of the **whole** equity book, whatever the scope.
   *
   * Read from the unscoped `equity` sleeve on purpose: a US-scoped sleeve's own regional
   * breakdown is trivially 100% US, which answers nothing. The question this card exists
   * for — how is the equity book distributed across regions? — is the same question
   * regardless of which region you are currently looking at, and it stays benchmarked
   * against the all-country index because a single-region index has no regional split to
   * compare to. Null when nobody uploaded a region breakdown.
   */
  equityRegions: BreakdownSeries | null;
  /** The index behind `equityRegions` — always the all-country one. */
  equityRegionsBenchmark: BenchmarkRef | null;
  fixedIncome: SleeveMarketData;
  /** Curve as of the latest date on or before `asOf`. Empty when never uploaded. */
  yieldCurve: YieldCurvePoint[];
  /** Full history up to `asOf`, oldest first. Empty when never uploaded. */
  creditSpreads: CreditSpreadPoint[];
}

export interface PortfolioTrendsResponse {
  summary: PortfolioTrendsSummary;
  filterOptions: PortfolioTrendsFilterOptions;
  /**
   * Analytics for the style / profitability / fixed-income cards, read from the pf_*
   * tables that `backend/portfolio_data` writes. Null when no analytics have been
   * uploaded at all — the cards then render their "requires market data" state rather
   * than an empty plot, which is the honest distinction between "nothing ingested" and
   * "ingested, and the answer is zero".
   */
  marketData: PortfolioMarketData | null;
}
