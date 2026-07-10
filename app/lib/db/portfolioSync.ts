/**
 * Projects `client_models` (engagements.sqlite) into `portfolio.sqlite`.
 *
 * This is the one place that reads across database files. It flattens each model's
 * JSON holdings into relational rows and stamps the client department, internal team
 * and office that logged it onto the model itself — the denormalization that lets the
 * Portfolio Trends query run against portfolio.sqlite alone, with no ATTACH.
 *
 * Idempotent: re-running produces identical rows. It is currently the only writer, so
 * portfolio.sqlite is stale between runs.
 *
 * Lives in the data layer rather than in scripts/ so the seed, the CLI, and any future
 * write-through hook all share one implementation.
 */
import { query, execute } from './index';
import { queryUsers } from './users';
import { replacePortfolioModelsForCrn, type PortfolioModelInput } from './portfolio';
import type { PortfolioHolding } from '@/app/lib/types/engagements';

/** Safe-parse the holdings JSON column (mirrors parseHoldings in ./clientModels.ts). */
function parseHoldings(raw: unknown): PortfolioHolding[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PortfolioHolding[]) : [];
  } catch {
    return [];
  }
}

function parseNames(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The office most of `members` belong to, or null when none resolve. Ties break
 * alphabetically so a re-run never flips its answer.
 */
function majorityOffice(members: string[], officeByMember: Map<string, string>): string | null {
  const counts = new Map<string, number>();
  for (const m of members) {
    const office = officeByMember.get(m);
    if (office) counts.set(office, (counts.get(office) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

export interface OfficeBackfillSummary {
  filled: number;
  unresolved: number;
}

/**
 * Fill `engagements.office` for interactions created before that column existed.
 *
 * Office lives on a person (users.sqlite) and an interaction's members can span
 * offices, so we take the majority among assigned members and fall back to the
 * creator's office. Rows that resolve to nothing stay NULL and are counted, not
 * guessed at — a wrong office is worse than a missing one.
 */
export async function backfillEngagementOffices(): Promise<OfficeBackfillSummary> {
  const pending = await query<{ id: number; team_members: string; created_by_id: string | null }>(
    `SELECT id, team_members, created_by_id FROM engagements WHERE office IS NULL`
  );
  if (pending.length === 0) return { filled: 0, unresolved: 0 };

  const memberRows = await queryUsers<{ display_name: string; office: string | null }>(
    `SELECT display_name, office FROM team_members WHERE display_name IS NOT NULL`
  );
  const officeByMember = new Map<string, string>();
  for (const r of memberRows) {
    if (r.office) officeByMember.set(r.display_name, r.office);
  }

  const userRows = await queryUsers<{ id: string; office: string | null }>(`SELECT id, office FROM users`);
  const officeByUser = new Map<string, string>();
  for (const r of userRows) {
    if (r.office) officeByUser.set(r.id, r.office);
  }

  let filled = 0;
  for (const e of pending) {
    const office =
      majorityOffice(parseNames(e.team_members), officeByMember) ??
      (e.created_by_id ? officeByUser.get(e.created_by_id) ?? null : null);
    if (!office) continue;
    await execute(`UPDATE engagements SET office = ? WHERE id = ?`, [office, e.id]);
    filled++;
  }

  return { filled, unresolved: pending.length - filled };
}

interface SourceRow {
  id: string;
  crn: string;
  client_name: string;
  model_name: string;
  is_main: number;
  aum: number | null;
  holdings: string;
  updated_at: string;
  logged_engagement_id: number | null;
  team: string | null;
  internal_client_dept: string | null;
  office: string | null;
}

export interface ModelSyncSummary {
  models: number;
  clients: number;
  /** Rows that can never satisfy an office-filtered query. */
  noOffice: number;
  /** Rows that can never satisfy an AUM threshold. */
  noAum: number;
}

/** Rebuild portfolio.sqlite from the current contents of client_models. */
export async function syncPortfolioModels(): Promise<ModelSyncSummary> {
  const rows = await query<SourceRow>(
    `SELECT cm.id, cm.crn, c.name AS client_name, cm.name AS model_name,
            cm.is_main, cm.aum, cm.holdings, cm.updated_at, cm.logged_engagement_id,
            e.team, e.internal_client_dept, e.office
       FROM client_models cm
       JOIN clients c          ON c.crn = cm.crn
       LEFT JOIN engagements e ON e.id  = cm.logged_engagement_id
      ORDER BY cm.crn, cm.sort_order`
  );

  // Group by client: replacePortfolioModelsForCrn deletes any model it isn't handed,
  // so it must see each client's full set at once.
  const byCrn = new Map<string, PortfolioModelInput[]>();
  let noOffice = 0;
  let noAum = 0;

  for (const r of rows) {
    if (!r.office) noOffice++;
    if (r.aum == null) noAum++;

    const list = byCrn.get(r.crn) ?? [];
    list.push({
      id: r.id,
      crn: r.crn,
      clientName: r.client_name,
      modelName: r.model_name,
      isMain: Boolean(r.is_main),
      aum: r.aum == null ? null : Number(r.aum),
      clientDept: r.internal_client_dept,
      loggedTeam: r.team,
      loggedOffice: r.office,
      // Current-state store: when this row was last logged, not a snapshot time.
      loggedAt: r.updated_at,
      sourceEngagementId: r.logged_engagement_id,
      holdings: parseHoldings(r.holdings),
    });
    byCrn.set(r.crn, list);
  }

  for (const [crn, models] of byCrn) {
    await replacePortfolioModelsForCrn(crn, models);
  }

  return { models: rows.length, clients: byCrn.size, noOffice, noAum };
}

export interface PortfolioSyncSummary extends ModelSyncSummary {
  backfill: OfficeBackfillSummary;
}

/** Backfill missing engagement offices, then project every model into portfolio.sqlite. */
export async function syncPortfolio(): Promise<PortfolioSyncSummary> {
  const backfill = await backfillEngagementOffices();
  const models = await syncPortfolioModels();
  return { ...models, backfill };
}
