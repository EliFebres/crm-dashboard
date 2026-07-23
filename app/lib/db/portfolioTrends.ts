/**
 * Aggregations for the Portfolio Trends dashboard, read from `portfolio.sqlite`.
 *
 * Two stores in one file, joined on model id:
 *
 *  - `portfolio_models` / `portfolio_holdings` — the projection of client_models that
 *    `npm run sync:portfolio` maintains. Client department, logging office, logging team
 *    and AUM are denormalized onto the model row, so every filter resolves here with no
 *    ATTACH and no join back to engagements.sqlite.
 *  - `pf_characteristics` / `pf_performance` / `pf_breakdowns` / `pf_benchmarks` /
 *    `pf_market_series` — the analytics written by `backend/portfolio_data`. These are
 *    sidecar tables: the app never creates them, and their absence is a normal state
 *    (nobody has uploaded yet), not an error.
 *
 * `pf_*.subject_id` holds a `client_models.id`, and `portfolio_models.id` reuses that same
 * id, so the join needs no translation. There is no foreign key between them — the
 * analytics are written by a different process — which is why every read here is an inner
 * join: a row whose model has since been deleted simply drops out.
 *
 * ## Why the analytics queries do not reuse buildWhere wholesale
 *
 * The summary applies the cohort filter as a *predicate* — "count models in any selected
 * cohort". The cards need cohorts as a *grouping* — one aggregate per cohort, and a model
 * can belong to two at once (its own model-name cohort, and Avg. Client when it is the
 * client's main). So the analytics reads apply every filter except cohorts, then group in
 * JS. One query, not one per cohort.
 */
import { queryPortfolio } from './portfolio';
import { hasDb } from './connection';
import type { ServerConstraints } from './queries';
import { AVG_CLIENT } from '@/app/lib/types/portfolioTrends';
import type {
  BreakdownSeries,
  Characteristics,
  CohortAggregate,
  CreditSpreadPoint,
  ModelPoint,
  PortfolioMarketData,
  PortfolioTrendsFilters,
  PortfolioTrendsFilterOptions,
  PortfolioTrendsResponse,
  Sleeve,
  SleeveMarketData,
  YieldCurvePoint,
} from '@/app/lib/types/portfolioTrends';

/** A model is "equity" when at least half its weight sits in Equity holdings. */
const EQUITY_DOMINANCE = 0.5;

/** "Recent Updates" counts models logged within this many days. */
const RECENT_DAYS = 30;

/** Canonical bucket order per dimension. Mirrors backend/portfolio_data/validation/vocabulary.py. */
const DIMENSION_BUCKETS: Record<string, string[]> = {
  region: ['US', 'Developed ex-US', 'Emerging Markets'],
  market_cap: ['Large', 'Mid', 'Small'],
  style: ['Value', 'Blend', 'Growth'],
  profitability: ['High', 'Mid', 'Low'],
  style_box: [
    'Large/Value', 'Large/Blend', 'Large/Growth',
    'Mid/Value', 'Mid/Blend', 'Mid/Growth',
    'Small/Value', 'Small/Blend', 'Small/Growth',
  ],
  credit_rating: ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC & Below', 'Not Rated'],
  security_type: ['Government', 'Municipal', 'Corporate', 'Securitized', 'Cash & Equivalents'],
  maturity_band: ['0-1Y', '1-3Y', '3-5Y', '5-7Y', '7-10Y', '10-20Y', '20Y+'],
};

/**
 * Which benchmark each sleeve is measured against. Mirrors SEED_BENCHMARKS in
 * backend/portfolio_data/validation/vocabulary.py — keep the two in step.
 *
 * A regional sleeve needs a regional index: measuring a US-only book against an
 * all-country index would report a US overweight that is an artifact of the scope rather
 * than a decision anyone made.
 */
const SLEEVE_BENCHMARK: Record<Sleeve, string> = {
  total: 'MSCI-ACWI-IMI',
  equity: 'MSCI-ACWI-IMI',
  equity_us: 'RUSSELL-3000',
  equity_developed: 'MSCI-WORLD-EX-USA-IMI',
  equity_em: 'MSCI-EM-IMI',
  fixed_income: 'BBG-US-AGG',
};

/** Sleeves the equity scope selector can ask for. */
const EQUITY_SLEEVES: Sleeve[] = ['equity', 'equity_us', 'equity_developed', 'equity_em'];

const EMPTY: PortfolioTrendsResponse = {
  summary: {
    modelsLogged: 0,
    uniqueClients: 0,
    equityModels: 0,
    fixedIncomeModels: 0,
    avgPositions: 0,
    recentUpdatesPct: 0,
    modelsWithoutAum: 0,
  },
  filterOptions: { departments: [], offices: [], teams: [], cohorts: [], periods: [] },
  marketData: null,
};

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

/**
 * WHERE clause for the filtered model set. `alias` qualifies the columns when the caller
 * joins holdings ('m'), and is omitted when querying portfolio_models alone.
 *
 * Team scoping mirrors teamScopeClause in ./queries.ts: a constrained user sees their own
 * team's models plus unassigned ones (logged_team IS NULL — a model whose logging
 * interaction predates team assignment, or was never attributed).
 *
 * `includeCohorts` is false for the analytics reads, which need cohorts as a grouping
 * rather than a filter — see the module comment.
 */
function buildWhere(
  filters: PortfolioTrendsFilters,
  sc: ServerConstraints,
  alias = '',
  includeCohorts = true
): { where: string; params: unknown[] } {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.departments?.length) {
    conditions.push(`${col('client_dept')} IN (${placeholders(filters.departments)})`);
    params.push(...filters.departments);
  }
  if (filters.offices?.length) {
    conditions.push(`${col('logged_office')} IN (${placeholders(filters.offices)})`);
    params.push(...filters.offices);
  }
  if (filters.teams?.length) {
    conditions.push(`${col('logged_team')} IN (${placeholders(filters.teams)})`);
    params.push(...filters.teams);
  }
  if (filters.minAum != null) {
    // Strict '>' matches "over $1B". NULL aum is excluded by SQL's NULL semantics.
    conditions.push(`${col('aum')} > ?`);
    params.push(filters.minAum);
  }

  if (includeCohorts && filters.cohorts?.length) {
    const names = filters.cohorts.filter((c) => c !== AVG_CLIENT);
    const parts: string[] = [];
    if (filters.cohorts.includes(AVG_CLIENT)) parts.push(`${col('is_main')} = 1`);
    if (names.length) {
      parts.push(`${col('model_name')} IN (${placeholders(names)})`);
      params.push(...names);
    }
    if (parts.length) conditions.push(`(${parts.join(' OR ')})`);
  }

  if (sc.team) {
    conditions.push(`(${col('logged_team')} = ? OR ${col('logged_team')} IS NULL)`);
    params.push(sc.team);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

interface SummaryRow {
  models: number;
  clients: number;
  no_aum: number;
  recent: number;
}

/**
 * True when the analytics tables exist at all.
 *
 * They are created by `backend/portfolio_data`, not by this app, so on a database where
 * nobody has uploaded yet they are simply absent — and querying a missing table throws.
 * Checked once per request rather than guarded per query.
 */
async function analyticsTablesExist(): Promise<boolean> {
  const rows = await queryPortfolio<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('pf_characteristics', 'pf_breakdowns', 'pf_benchmarks', 'pf_market_series')`
  );
  return Number(rows[0]?.n ?? 0) === 4;
}

/** Distinct value present in the data — not the admin registries, so every option returns rows. */
async function loadFilterOptions(hasAnalytics: boolean): Promise<PortfolioTrendsFilterOptions> {
  const [depts, offices, teams, cohorts, mains, periods] = await Promise.all([
    queryPortfolio<{ v: string }>(
      `SELECT DISTINCT client_dept AS v FROM portfolio_models WHERE client_dept IS NOT NULL ORDER BY v COLLATE NOCASE`
    ),
    queryPortfolio<{ v: string }>(
      `SELECT DISTINCT logged_office AS v FROM portfolio_models WHERE logged_office IS NOT NULL ORDER BY v COLLATE NOCASE`
    ),
    queryPortfolio<{ v: string }>(
      `SELECT DISTINCT logged_team AS v FROM portfolio_models WHERE logged_team IS NOT NULL ORDER BY v COLLATE NOCASE`
    ),
    queryPortfolio<{ name: string; n: number }>(
      `SELECT model_name AS name, COUNT(*) AS n FROM portfolio_models
        GROUP BY model_name ORDER BY n DESC, name COLLATE NOCASE`
    ),
    queryPortfolio<{ n: number }>(`SELECT COUNT(*) AS n FROM portfolio_models WHERE is_main = 1`),
    // Periods come from what was actually uploaded. Offering a quarter with no data would
    // render every card empty and read as a bug rather than as "not ingested yet".
    hasAnalytics
      ? queryPortfolio<{ v: string }>(
          `SELECT DISTINCT as_of AS v FROM pf_characteristics ORDER BY v DESC`
        )
      : Promise.resolve([]),
  ]);

  return {
    departments: depts.map((r) => r.v),
    offices: offices.map((r) => r.v),
    teams: teams.map((r) => r.v),
    // Avg. Client leads: it is the default selection and the only cross-client cohort.
    cohorts: [
      { name: AVG_CLIENT, modelCount: Number(mains[0]?.n ?? 0) },
      ...cohorts.map((r) => ({ name: r.name, modelCount: Number(r.n) })),
    ],
    periods: periods.map((r) => r.v),
  };
}

// ---------------------------------------------------------------------------------
// Analytics reads
// ---------------------------------------------------------------------------------

/** Column names on pf_characteristics, paired with the camelCase key they become. */
const CHARACTERISTIC_COLUMNS: Array<[string, keyof Characteristics]> = [
  ['wtd_avg_market_cap', 'wtdAvgMarketCap'],
  ['median_market_cap', 'medianMarketCap'],
  ['price_to_book', 'priceToBook'],
  ['price_to_earnings', 'priceToEarnings'],
  ['price_to_sales', 'priceToSales'],
  ['profitability', 'profitability'],
  ['dividend_yield', 'dividendYield'],
  ['return_on_equity', 'returnOnEquity'],
  ['underlying_companies', 'underlyingCompanies'],
  ['effective_duration', 'effectiveDuration'],
  ['effective_maturity', 'effectiveMaturity'],
  ['yield_to_maturity', 'yieldToMaturity'],
  ['sec_yield', 'secYield'],
  ['avg_coupon', 'avgCoupon'],
  ['num_holdings', 'numHoldings'],
  ['expense_ratio', 'expenseRatio'],
  ['turnover', 'turnover'],
];

const CHARACTERISTIC_SELECT = CHARACTERISTIC_COLUMNS.map(([col]) => `c.${col}`).join(', ');

type CharacteristicRow = Record<string, unknown>;

function rowToCharacteristics(row: CharacteristicRow): Characteristics {
  const out: Characteristics = {};
  for (const [col, key] of CHARACTERISTIC_COLUMNS) {
    const value = row[col];
    if (value != null && Number.isFinite(Number(value))) {
      (out[key] as number) = Number(value);
    }
  }
  const quality = row['avg_credit_quality'];
  if (typeof quality === 'string' && quality.trim()) out.avgCreditQuality = quality;
  return out;
}

/**
 * Mean of each metric across the models that reported it.
 *
 * Equal-weighted rather than AUM-weighted, deliberately: AUM is unrecorded on a
 * meaningful share of models (the summary strip counts how many), so an AUM weighting
 * would silently drop them from the average. `metricCounts` carries the per-metric
 * denominator so the caller can tell a settled figure from one computed off two models.
 */
function aggregate(cohort: string, rows: CharacteristicRow[]): CohortAggregate {
  const sums = new Map<keyof Characteristics, number>();
  const counts = new Map<string, number>();

  for (const row of rows) {
    const c = rowToCharacteristics(row);
    for (const [, key] of CHARACTERISTIC_COLUMNS) {
      const value = c[key];
      if (typeof value !== 'number') continue;
      sums.set(key, (sums.get(key) ?? 0) + value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const characteristics: Characteristics = {};
  const metricCounts: Record<string, number> = {};
  for (const [key, total] of sums) {
    const n = counts.get(key) ?? 0;
    if (n > 0) {
      (characteristics[key] as number) = total / n;
      metricCounts[key] = n;
    }
  }

  return { cohort, modelCount: rows.length, characteristics, metricCounts };
}

/** Which of the selected cohorts a model row belongs to. A main model belongs to two. */
function cohortsForRow(
  row: { model_name: string; is_main: number },
  selected: readonly string[]
): string[] {
  const out: string[] = [];
  if (selected.includes(AVG_CLIENT) && Number(row.is_main) === 1) out.push(AVG_CLIENT);
  if (selected.includes(row.model_name)) out.push(row.model_name);
  return out;
}

interface ModelCharacteristicRow extends CharacteristicRow {
  id: string;
  model_name: string;
  client_name: string;
  is_main: number;
}

interface BreakdownRow {
  id: string;
  model_name: string;
  is_main: number;
  dimension: string;
  bucket: string;
  weight: number;
}

/** Everything one sleeve needs, in two queries plus the benchmark's two. */
async function loadSleeve(
  sleeve: Sleeve,
  asOf: string,
  filters: PortfolioTrendsFilters,
  sc: ServerConstraints,
  selectedCohorts: string[]
): Promise<SleeveMarketData> {
  const base = buildWhere(filters, sc, 'm', false);
  const scopeSql = base.where ? `AND ${base.where.slice('WHERE '.length)}` : '';
  const benchmarkId = SLEEVE_BENCHMARK[sleeve];

  const [modelRows, breakdownRows, benchmarkRows, benchmarkBreakdowns, benchmarkMeta] =
    await Promise.all([
      queryPortfolio<ModelCharacteristicRow>(
        `SELECT m.id, m.model_name, m.client_name, m.is_main,
                ${CHARACTERISTIC_SELECT}, c.avg_credit_quality
           FROM pf_characteristics c
           JOIN portfolio_models m ON m.id = c.subject_id
          WHERE c.subject_kind = 'model' AND c.sleeve = ? AND c.as_of = ? ${scopeSql}`,
        [sleeve, asOf, ...base.params]
      ),
      queryPortfolio<BreakdownRow>(
        `SELECT m.id, m.model_name, m.is_main, b.dimension, b.bucket, b.weight
           FROM pf_breakdowns b
           JOIN portfolio_models m ON m.id = b.subject_id
          WHERE b.subject_kind = 'model' AND b.sleeve = ? AND b.as_of = ? ${scopeSql}`,
        [sleeve, asOf, ...base.params]
      ),
      queryPortfolio<CharacteristicRow>(
        `SELECT ${CHARACTERISTIC_SELECT}, c.avg_credit_quality
           FROM pf_characteristics c
          WHERE c.subject_kind = 'benchmark' AND c.subject_id = ? AND c.sleeve = ? AND c.as_of = ?`,
        [benchmarkId, sleeve, asOf]
      ),
      queryPortfolio<{ dimension: string; bucket: string; weight: number }>(
        `SELECT dimension, bucket, weight FROM pf_breakdowns
          WHERE subject_kind = 'benchmark' AND subject_id = ? AND sleeve = ? AND as_of = ?`,
        [benchmarkId, sleeve, asOf]
      ),
      queryPortfolio<{ id: string; name: string }>(
        `SELECT id, name FROM pf_benchmarks WHERE id = ?`,
        [benchmarkId]
      ),
    ]);

  // --- cohort aggregates -----------------------------------------------------------
  const byCohort = new Map<string, ModelCharacteristicRow[]>();
  for (const row of modelRows) {
    for (const cohort of cohortsForRow(row, selectedCohorts)) {
      const list = byCohort.get(cohort) ?? [];
      list.push(row);
      byCohort.set(cohort, list);
    }
  }
  // Selection order, so the legend matches the filter chips. Cohorts with no analytics
  // are dropped rather than shown as zero — an empty average is not a value of zero.
  const cohorts = selectedCohorts
    .filter((name) => (byCohort.get(name)?.length ?? 0) > 0)
    .map((name) => aggregate(name, byCohort.get(name) ?? []));

  // --- breakdowns ------------------------------------------------------------------
  // A distribution averages the same way a metric does: mean weight per bucket across the
  // cohort's models. Since every model's distribution sums to 1, so does the mean.
  const breakdowns: Record<string, BreakdownSeries> = {};
  const sums = new Map<string, Map<string, Map<string, number>>>(); // dim -> cohort -> bucket -> sum
  const modelsPerDim = new Map<string, Map<string, Set<string>>>(); // dim -> cohort -> model names

  for (const row of breakdownRows) {
    for (const cohort of cohortsForRow(row, selectedCohorts)) {
      const dim = sums.get(row.dimension) ?? new Map();
      const cohortBuckets = dim.get(cohort) ?? new Map<string, number>();
      cohortBuckets.set(row.bucket, (cohortBuckets.get(row.bucket) ?? 0) + Number(row.weight));
      dim.set(cohort, cohortBuckets);
      sums.set(row.dimension, dim);

      const dimModels = modelsPerDim.get(row.dimension) ?? new Map();
      const set = dimModels.get(cohort) ?? new Set<string>();
      // Keyed on the model id, not its name: "Core Model" exists at many clients, and
      // collapsing them would divide a cohort's summed weights by too small a number,
      // producing a distribution that sums to well over 1.
      set.add(row.id);
      dimModels.set(cohort, set);
      modelsPerDim.set(row.dimension, dimModels);
    }
  }

  const benchmarkByDim = new Map<string, Record<string, number>>();
  for (const row of benchmarkBreakdowns) {
    const existing = benchmarkByDim.get(row.dimension) ?? {};
    existing[row.bucket] = Number(row.weight);
    benchmarkByDim.set(row.dimension, existing);
  }

  const dimensions = new Set([...sums.keys(), ...benchmarkByDim.keys()]);
  for (const dimension of dimensions) {
    const cohortWeights: Record<string, Record<string, number>> = {};
    const dimSums = sums.get(dimension);
    const dimModels = modelsPerDim.get(dimension);
    if (dimSums) {
      for (const [cohort, buckets] of dimSums) {
        const n = dimModels?.get(cohort)?.size ?? 0;
        if (n === 0) continue;
        const averaged: Record<string, number> = {};
        for (const [bucket, total] of buckets) averaged[bucket] = total / n;
        cohortWeights[cohort] = averaged;
      }
    }
    breakdowns[dimension] = {
      dimension,
      // Canonical order when we know the dimension; otherwise whatever came back, sorted,
      // so an unrecognized dimension still renders deterministically.
      buckets:
        DIMENSION_BUCKETS[dimension] ??
        [...new Set(
          [...Object.values(cohortWeights).flatMap((w) => Object.keys(w)),
           ...Object.keys(benchmarkByDim.get(dimension) ?? {})]
        )].sort(),
      cohorts: cohortWeights,
      benchmark: benchmarkByDim.get(dimension) ?? null,
    };
  }

  // --- benchmark aggregate ---------------------------------------------------------
  const ref = benchmarkMeta[0];
  const benchmark =
    benchmarkRows.length > 0 && ref
      ? {
          ...aggregate(ref.name, benchmarkRows),
          ref: { id: ref.id, name: ref.name },
        }
      : null;

  const models: ModelPoint[] = modelRows.map((row) => ({
    modelId: row.id,
    clientName: row.client_name,
    modelName: row.model_name,
    isMain: Number(row.is_main) === 1,
    characteristics: rowToCharacteristics(row),
  }));

  return { cohorts, benchmark, models, breakdowns };
}

async function loadYieldCurve(asOf: string): Promise<YieldCurvePoint[]> {
  // The curve as of the latest date on or before the selected period. A quarter end is
  // often not a trading day, and the curve is uploaded daily, so an exact-date match
  // would silently return nothing perfectly often.
  const rows = await queryPortfolio<{ tenor: string; value: number }>(
    `SELECT tenor, value FROM pf_market_series
      WHERE series = 'ust_par_yield'
        AND as_of = (SELECT MAX(as_of) FROM pf_market_series
                      WHERE series = 'ust_par_yield' AND as_of <= ?)`,
    [asOf]
  );

  // Tenors sort by duration, not lexically — '3M' before '1Y', '2Y' before '10Y'.
  const months = (tenor: string): number => {
    const match = /^(\d+)([MY])$/.exec(tenor);
    if (!match) return Number.MAX_SAFE_INTEGER;
    return Number(match[1]) * (match[2] === 'Y' ? 12 : 1);
  };
  return rows
    .map((r) => ({ tenor: r.tenor, yield: Number(r.value) }))
    .sort((a, b) => months(a.tenor) - months(b.tenor));
}

async function loadCreditSpreads(asOf: string): Promise<CreditSpreadPoint[]> {
  const rows = await queryPortfolio<{ as_of: string; series: string; value: number }>(
    `SELECT as_of, series, value FROM pf_market_series
      WHERE series IN ('ig_oas', 'hy_oas') AND as_of <= ?
      ORDER BY as_of`,
    [asOf]
  );
  const byDate = new Map<string, CreditSpreadPoint>();
  for (const row of rows) {
    const point = byDate.get(row.as_of) ?? { asOf: row.as_of, ig: null, hy: null };
    if (row.series === 'ig_oas') point.ig = Number(row.value);
    else point.hy = Number(row.value);
    byDate.set(row.as_of, point);
  }
  return [...byDate.values()];
}

/**
 * Resolve the requested period to one that actually holds data.
 *
 * Falls back to the newest available rather than returning nothing, because an upload
 * lagging a quarter is normal and "the page is blank" is a bad way to communicate it —
 * the resolved date comes back as `marketData.asOf` so the UI can say which period it
 * is showing.
 */
function resolveAsOf(requested: string | null | undefined, available: string[]): string | null {
  if (available.length === 0) return null;
  if (requested && available.includes(requested)) return requested;
  return available[0];
}

/** Models whose weight in `assetClass` reaches the dominance threshold. */
function dominanceQuery(assetClass: string, where: string): string {
  return `SELECT COUNT(*) AS n FROM (
            SELECT m.id
              FROM portfolio_models m
              JOIN portfolio_holdings h ON h.model_id = m.id
             ${where}
             GROUP BY m.id
            HAVING SUM(CASE WHEN h.asset_class = ? THEN h.weight ELSE 0 END) >= ${EQUITY_DOMINANCE}
          )`;
}

/**
 * Summary stats, filter options, and the analytics behind every card.
 *
 * ## What the Data Metrics strip counts
 *
 * The strip describes the *dataset* — every model the current scope contains — so it
 * applies the department, office, team and AUM filters but deliberately **not** the
 * Portfolios (cohort) filter. Cohort is a series selector: it decides which averages the
 * charts plot, not which models exist. Scoping the strip by it made the corpus look
 * smaller than it is, and because that filter always keeps at least one cohort selected
 * (`noAllOption`), there was no state in which the strip could show the real total. It
 * also disagreed on screen with the scatter's own "69 models" footnote, which counts the
 * same population.
 *
 * ## Equity vs fixed income
 *
 * Decided per model by which asset class holds at least half its weight, since the store
 * has no per-model flag and weights are normalized to sum to 1. The two counts are
 * independent questions, not a partition:
 *
 *  - a model that is mostly Alternatives, Crypto, Multi-Asset or Cash is in neither, and
 *  - so is a model with no holdings at all,
 *
 * so they need not add up to `modelsLogged`. That is the fix for the previous
 * `fixedIncomeModels = modelsLogged - equityModels`, which labelled everything that
 * merely *wasn't* equity-dominant as fixed income — including empty models. The current
 * data hides the bug (it holds only Equity and Fixed Income holdings, so the subtraction
 * happened to be right); real holdings would not.
 */
export async function computePortfolioTrends(
  filters: PortfolioTrendsFilters,
  sc: ServerConstraints
): Promise<PortfolioTrendsResponse> {
  if (!hasDb()) return EMPTY;

  // includeCohorts=false — see the note above.
  const model = buildWhere(filters, sc, '', false);
  const joined = buildWhere(filters, sc, 'm', false);
  const hasAnalytics = await analyticsTablesExist();

  const [summaryRows, holdingRows, equityRows, fixedIncomeRows, filterOptions] = await Promise.all([
    queryPortfolio<SummaryRow>(
      `SELECT COUNT(*) AS models,
              COUNT(DISTINCT crn) AS clients,
              SUM(CASE WHEN aum IS NULL THEN 1 ELSE 0 END) AS no_aum,
              SUM(CASE WHEN julianday('now') - julianday(logged_at) <= ${RECENT_DAYS} THEN 1 ELSE 0 END) AS recent
         FROM portfolio_models ${model.where}`,
      model.params
    ),
    // Positions, and how many models carry any — a model with no holdings would otherwise
    // drag the average down as if it were a real zero-position portfolio.
    queryPortfolio<{ n: number; models: number }>(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT m.id) AS models
         FROM portfolio_holdings h
         JOIN portfolio_models m ON m.id = h.model_id
        ${joined.where}`,
      joined.params
    ),
    queryPortfolio<{ n: number }>(dominanceQuery('Equity', joined.where), [...joined.params, 'Equity']),
    queryPortfolio<{ n: number }>(
      dominanceQuery('Fixed Income', joined.where), [...joined.params, 'Fixed Income']
    ),
    loadFilterOptions(hasAnalytics),
  ]);

  const row = summaryRows[0];
  const modelsLogged = Number(row?.models ?? 0);
  const totalHoldings = Number(holdingRows[0]?.n ?? 0);
  const modelsWithHoldings = Number(holdingRows[0]?.models ?? 0);
  const recent = Number(row?.recent ?? 0);

  const summary = {
    modelsLogged,
    uniqueClients: Number(row?.clients ?? 0),
    equityModels: Number(equityRows[0]?.n ?? 0),
    fixedIncomeModels: Number(fixedIncomeRows[0]?.n ?? 0),
    avgPositions: modelsWithHoldings ? Math.round(totalHoldings / modelsWithHoldings) : 0,
    recentUpdatesPct: modelsLogged ? Math.round((recent / modelsLogged) * 100) : 0,
    modelsWithoutAum: Number(row?.no_aum ?? 0),
  };

  const asOf = hasAnalytics ? resolveAsOf(filters.asOf, filterOptions.periods) : null;
  if (!asOf) {
    // Nothing ingested — the cards keep their "requires market data" state, which is a
    // different claim from "ingested, and every value is zero".
    return { summary, filterOptions, marketData: null };
  }

  const selectedCohorts = filters.cohorts?.length ? filters.cohorts : [AVG_CLIENT];

  // An unknown sleeve falls back to the whole equity book rather than returning nothing —
  // a stale bookmark should show the default view, not an empty page.
  const requested = filters.equitySleeve;
  const equitySleeve: Sleeve =
    requested && EQUITY_SLEEVES.includes(requested) ? requested : 'equity';

  const [equity, fixedIncome, yieldCurve, creditSpreads, unscopedEquity] = await Promise.all([
    loadSleeve(equitySleeve, asOf, filters, sc, selectedCohorts),
    loadSleeve('fixed_income', asOf, filters, sc, selectedCohorts),
    loadYieldCurve(asOf),
    loadCreditSpreads(asOf),
    // The regional split always describes the whole book — see `equityRegions` on the
    // response type. Skipped when the scope already is the whole book.
    equitySleeve === 'equity'
      ? Promise.resolve(null)
      : loadSleeve('equity', asOf, filters, sc, selectedCohorts),
  ]);

  const regionSource = unscopedEquity ?? equity;
  const marketData: PortfolioMarketData = {
    asOf,
    equity,
    equitySleeve,
    equityRegions: regionSource.breakdowns['region'] ?? null,
    equityRegionsBenchmark: regionSource.benchmark?.ref ?? null,
    fixedIncome,
    yieldCurve,
    creditSpreads,
  };
  return { summary, filterOptions, marketData };
}
