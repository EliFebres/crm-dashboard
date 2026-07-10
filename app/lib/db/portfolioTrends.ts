/**
 * Aggregations for the Portfolio Trends dashboard, read from `portfolio.sqlite`.
 *
 * Everything here resolves against that one file — client department, logging office,
 * logging team and AUM are all denormalized onto `portfolio_models`, so no ATTACH and
 * no join back to engagements.sqlite is needed. See app/lib/db/portfolio.ts.
 *
 * Scope of what this can answer: the store holds identifiers, asset class, constituent
 * type and weight. It holds NO market data — no market cap, price-to-book, profitability,
 * duration, credit rating, yield or maturity. Anything the dashboard needs from a security
 * master therefore cannot be computed here, and `marketData` is null until one exists.
 */
import { queryPortfolio } from './portfolio';
import { hasDb } from './connection';
import type { ServerConstraints } from './queries';
import { AVG_CLIENT } from '@/app/lib/types/portfolioTrends';
import type {
  PortfolioTrendsFilters,
  PortfolioTrendsFilterOptions,
  PortfolioTrendsResponse,
} from '@/app/lib/types/portfolioTrends';

/** A model is "equity" when at least half its weight sits in Equity holdings. */
const EQUITY_DOMINANCE = 0.5;

/** "Recent Updates" counts models logged within this many days. */
const RECENT_DAYS = 30;

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
  filterOptions: { departments: [], offices: [], teams: [], cohorts: [] },
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
 */
function buildWhere(
  filters: PortfolioTrendsFilters,
  sc: ServerConstraints,
  alias = ''
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

  if (filters.cohorts?.length) {
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

/** Distinct values present in the data — not the admin registries, so every option returns rows. */
async function loadFilterOptions(): Promise<PortfolioTrendsFilterOptions> {
  const [depts, offices, teams, cohorts, mains] = await Promise.all([
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
  };
}

/**
 * Summary stats + filter options for the current selection.
 *
 * Equity vs fixed-income is decided per model by which asset class holds the majority of
 * its weight, rather than by any per-model flag — the store has no such flag, and weights
 * are normalized to sum to 1.
 */
export async function computePortfolioTrends(
  filters: PortfolioTrendsFilters,
  sc: ServerConstraints
): Promise<PortfolioTrendsResponse> {
  if (!hasDb()) return EMPTY;

  const model = buildWhere(filters, sc);
  const joined = buildWhere(filters, sc, 'm');

  const [summaryRows, holdingRows, equityRows, filterOptions] = await Promise.all([
    queryPortfolio<SummaryRow>(
      `SELECT COUNT(*) AS models,
              COUNT(DISTINCT crn) AS clients,
              SUM(CASE WHEN aum IS NULL THEN 1 ELSE 0 END) AS no_aum,
              SUM(CASE WHEN julianday('now') - julianday(logged_at) <= ${RECENT_DAYS} THEN 1 ELSE 0 END) AS recent
         FROM portfolio_models ${model.where}`,
      model.params
    ),
    queryPortfolio<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM portfolio_holdings h
         JOIN portfolio_models m ON m.id = h.model_id
        ${joined.where}`,
      joined.params
    ),
    queryPortfolio<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT m.id
           FROM portfolio_models m
           JOIN portfolio_holdings h ON h.model_id = m.id
          ${joined.where}
          GROUP BY m.id
         HAVING SUM(CASE WHEN h.asset_class = 'Equity' THEN h.weight ELSE 0 END) >= ${EQUITY_DOMINANCE}
       )`,
      joined.params
    ),
    loadFilterOptions(),
  ]);

  const row = summaryRows[0];
  const modelsLogged = Number(row?.models ?? 0);
  const equityModels = Number(equityRows[0]?.n ?? 0);
  const totalHoldings = Number(holdingRows[0]?.n ?? 0);
  const recent = Number(row?.recent ?? 0);

  return {
    summary: {
      modelsLogged,
      uniqueClients: Number(row?.clients ?? 0),
      equityModels,
      // Everything that isn't equity-dominant, including models with no holdings at all.
      fixedIncomeModels: modelsLogged - equityModels,
      avgPositions: modelsLogged ? Math.round(totalHoldings / modelsLogged) : 0,
      recentUpdatesPct: modelsLogged ? Math.round((recent / modelsLogged) * 100) : 0,
      modelsWithoutAum: Number(row?.no_aum ?? 0),
    },
    filterOptions,
    marketData: null,
  };
}
