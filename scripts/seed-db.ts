/**
 * =============================================================================
 * SQLite Seed Script
 * =============================================================================
 *
 * Creates the database schema (via the app's own bootstrap) and optionally
 * populates it with mock data for development/testing.
 *
 * `--with-mock` fills EVERY table the dashboard reads, not just clients +
 * engagements: three working teams plus read-only Leadership/Guest users, NNA
 * breakdowns and notes, multiple model portfolios per client (with a main flag +
 * AUM), CRN-pending clients, an append-only note history with multiple authors,
 * the internal-client registry, project filepaths, funnel parent/child links,
 * team members (active and inactive), activity logs and presence rows.
 *
 * `--reset` first wipes the previous mock data (engagements, clients, notes,
 * models, seed users/members/activity and the portfolio projection) so the mock
 * set can be regenerated. Non-seed user accounts are kept. It refuses to run when
 * the database holds clients or interactions the seed didn't create, unless
 * `--force` is also passed.
 *
 * Usage:
 *   npx tsx scripts/seed-db.ts                            # Create schema only
 *   npx tsx scripts/seed-db.ts --with-mock                # Schema + seed (empty DB only)
 *   npx tsx scripts/seed-db.ts --with-mock --reset        # Wipe mock data, then reseed
 *   npx tsx scripts/seed-db.ts --with-mock --reset --force  # ...even over non-seed data
 *
 * Requires SQLITE_DIR to be set (via .env or environment):
 *   SQLITE_DIR=./data npx tsx scripts/seed-db.ts --with-mock
 * =============================================================================
 */

// Load .env before anything else
import { config } from 'dotenv';
config({ path: '.env' });

import { randomUUID } from 'crypto';
import { query, executeTransaction } from '../app/lib/db';
import {
  engagements,
  clients,
  teamMemberOffices,
  teamMemberTeams,
  inactiveMembers,
  pendingCrnClients,
  newClientCrns,
  MOCK_TEAMS,
  CUSTOM_PROJECT_TYPES,
  type MockEngagement,
} from '../app/lib/data/engagements';
import { replaceClientModels } from '../app/lib/db/clientModels';
import { syncPortfolio } from '../app/lib/db/portfolioSync';
import { executePortfolio } from '../app/lib/db/portfolio';
import { queryUsers, executeUsers, DEFAULT_TITLES } from '../app/lib/db/users';
import { executeActivity } from '../app/lib/db/activity';
import { hashPassword } from '../app/lib/auth/password';
import { toDisplayName, READ_ONLY_TEAMS } from '../app/lib/auth/types';
import type { PortfolioHolding, AssetClass } from '../app/lib/types/engagements';

// -----------------------------------------------------------------------------
// Small deterministic helpers (no faker) so a re-seed produces identical data.
// -----------------------------------------------------------------------------
function rng(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

/** Converts a display date string like "Jan 15, 2025" to ISO "2025-01-15". */
function parseDisplayDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toISOString().split('T')[0];
}

/** Marker (in app_migrations) recording the highest engagement id the seed wrote. */
const SEED_MARKER_PREFIX = 'mock_seed:max_engagement_id=';

/**
 * Portfolio Trends' headline question is "Brokerage models over $1B logged out of a
 * given office". Nothing in the generated mock data guarantees such a row — seeded AUM
 * tops out at $500M — so one interaction is pinned as the fixture that satisfies it.
 * Prefer a Brokerage interaction already logged from Office A that captured a
 * portfolio; if the generator produced none, take any Brokerage one and pin its office.
 */
const FLAGSHIP_AUM = 1_250_000_000;
const FLAGSHIP_OFFICE = 'Office A';
const flagship =
  engagements.find(e => e.internalClient.clientDept === 'Brokerage' && e.office === FLAGSHIP_OFFICE && !!e.portfolio?.length) ??
  engagements.find(e => e.internalClient.clientDept === 'Brokerage' && !!e.portfolio?.length);

// =============================================================================
// Seed users. `display` links the account to a mock team member ("First L.").
// =============================================================================
const SEED_USERS = [
  { first: 'Alex', last: 'Morgan', title: 'Head of Department', team: 'Default Team', office: 'Office A', role: 'admin', status: 'active', display: 'Alex M.' },
  { first: 'Blake', last: 'Nguyen', title: 'Manager', team: 'Default Team', office: 'Office A', role: 'user', status: 'active', display: 'Blake N.' },
  { first: 'Casey', last: 'Patel', title: 'Associate', team: 'Default Team', office: 'Office A', role: 'user', status: 'active', display: 'Casey P.' },
  { first: 'Finley', last: 'Torres', title: 'Head of Team', team: 'Equity Specialist', office: 'Office B', role: 'user', status: 'active', display: 'Finley T.' },
  { first: 'Harper', last: 'Brooks', title: 'Analyst', team: 'Equity Specialist', office: 'Office B', role: 'user', status: 'pending', display: 'Harper B.' },
  { first: 'Jules', last: 'Diaz', title: 'Head of Team', team: 'Fixed Income Specialist', office: 'Office B', role: 'user', status: 'active', display: 'Jules D.' },
  { first: 'Indi', last: 'Chen', title: 'Associate', team: 'Fixed Income Specialist', office: 'Office B', role: 'user', status: 'pending', display: null },
  { first: 'Morgan', last: 'Kelly', title: 'Associate', team: 'Default Team', office: 'Office B', role: 'user', status: 'inactive', display: 'Morgan K.' },
  { first: 'Rory', last: 'Kim', title: 'Head of Department', team: 'Leadership', office: 'Office A', role: 'user', status: 'active', display: null },
  { first: 'Pat', last: 'Lee', title: 'Analyst', team: 'Guest', office: 'Office B', role: 'user', status: 'active', display: null },
] as const;

const emailOf = (u: { first: string; last: string }) => `${u.first.toLowerCase()}.${u.last.toLowerCase()}@example.com`;

interface KnownUser { id: string; name: string; email: string; office: string; team: string; status: string; isSeed: boolean }

/** Every user account keyed by its "First L." display name (seed and real). */
async function loadUsersByDisplay(): Promise<Map<string, KnownUser>> {
  const rows = await queryUsers<{ id: string; email: string; first_name: string; last_name: string; office: string; team: string; status: string; is_seed: number }>(
    `SELECT id, email, first_name, last_name, office, team, status, is_seed FROM users`
  );
  const map = new Map<string, KnownUser>();
  for (const r of rows) {
    const display = toDisplayName(r.first_name, r.last_name);
    // A real account wins over a seed account with the same display name.
    if (map.has(display) && r.is_seed) continue;
    map.set(display, {
      id: r.id, name: `${r.first_name} ${r.last_name}`, email: r.email,
      office: r.office, team: r.team, status: r.status, isSeed: Boolean(r.is_seed),
    });
  }
  return map;
}

/**
 * The mock "Default Team" stands in for the real signed-in user's team: if the
 * account behind "Eli F." sits on a different (writable) team, mock Default Team
 * data is written under that name so the team and "me" KPI scopes line up.
 */
let homeTeam = 'Default Team';
const teamName = (t: string | null): string | null => (t === 'Default Team' ? homeTeam : t);

async function main() {
  const dbDir = process.env.SQLITE_DIR || process.env.DUCKDB_DIR;
  if (!dbDir) {
    console.error('ERROR: SQLITE_DIR environment variable is not set.');
    console.error('Create a .env file with: SQLITE_DIR=./data');
    process.exit(1);
  }

  // The first query triggers the app's bootstrap, which creates the schema and
  // runs all idempotent migrations — keeping a single source of truth.
  console.log('Ensuring schema...');
  await query('SELECT COUNT(*) AS cnt FROM engagements');
  console.log('Schema ready.');

  const withMock = process.argv.includes('--with-mock');
  if (!withMock) {
    console.log('Done. Run with --with-mock to populate with mock data.');
    return;
  }

  if (process.argv.includes('--reset')) {
    const ok = await resetMockData(process.argv.includes('--force'));
    if (!ok) process.exit(1);
  }

  // Resolve the home team from the real account behind "Eli F.", if any.
  const eli = (await loadUsersByDisplay()).get('Eli F.');
  if (eli && !eli.isSeed && eli.team && !(READ_ONLY_TEAMS as readonly string[]).includes(eli.team)) {
    homeTeam = eli.team;
  }
  if (homeTeam !== 'Default Team') console.log(`Mock "Default Team" data will be written under "${homeTeam}".`);

  // Users first: engagement creators and note authors link to real user ids.
  await seedUsersAndActivity();
  const usersByDisplay = await loadUsersByDisplay();

  // Guard on BOTH tables: a client created via the app UI (with no engagements
  // yet) would otherwise slip past an engagements-only check and then crash the
  // seed transaction on the clients.name UNIQUE index.
  const [engRows, clientRows] = await Promise.all([
    query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM engagements'),
    query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM clients'),
  ]);
  const existingCount = Number(engRows[0]?.cnt ?? 0);
  const existingClients = Number(clientRows[0]?.cnt ?? 0);
  if (existingCount > 0 || existingClients > 0) {
    console.log(
      `Database already has ${existingClients} client(s) and ${existingCount} engagement(s). Skipping engagement seed.`
    );
    console.log('To re-seed, run: npm run seed:reset');
  } else {
    await seedEngagements(usersByDisplay);
    await seedClientModels();
    await seedActivityLogs(usersByDisplay);
  }

  // Last: the projection reads engagements (Part A) AND the offices/roster (Part B),
  // so it can only run once both exist.
  console.log('Syncing portfolio.sqlite...');
  const p = await syncPortfolio();
  console.log(`  ${p.models} model(s) across ${p.clients} client(s).`);

  console.log('Done.');
}

// =============================================================================
// Reset — wipe the previous mock data set
// =============================================================================
async function resetMockData(force: boolean): Promise<boolean> {
  // Anything the seed didn't write: clients not stamped 'Seed', and interactions
  // past the seed's recorded max id (or, for older seeds without the marker, not
  // stamped 'Seed').
  const marker = await query<{ name: string }>(`SELECT name FROM app_migrations WHERE name LIKE ?`, [`${SEED_MARKER_PREFIX}%`]);
  const maxSeedId = marker.length ? Number(marker[0].name.slice(SEED_MARKER_PREFIX.length)) : null;
  const [foreignClients, foreignEngagements] = await Promise.all([
    query<{ crn: string; name: string }>(`SELECT crn, name FROM clients WHERE created_by_name IS NOT 'Seed'`),
    maxSeedId !== null
      ? query<{ id: number }>(`SELECT id FROM engagements WHERE id > ?`, [maxSeedId])
      : query<{ id: number }>(`SELECT id FROM engagements WHERE created_by_name IS NOT 'Seed'`),
  ]);
  if ((foreignClients.length || foreignEngagements.length) && !force) {
    console.error('ERROR: refusing to reset — the database holds data the seed did not create:');
    if (foreignClients.length) {
      console.error(`  ${foreignClients.length} client(s): ${foreignClients.slice(0, 5).map(c => `${c.name} (${c.crn})`).join(', ')}${foreignClients.length > 5 ? ', …' : ''}`);
    }
    if (foreignEngagements.length) {
      console.error(`  ${foreignEngagements.length} interaction(s): ids ${foreignEngagements.slice(0, 10).map(e => e.id).join(', ')}${foreignEngagements.length > 10 ? ', …' : ''}`);
    }
    console.error('Re-run with --force to delete them too.');
    return false;
  }

  console.log('Resetting mock data...');
  await executeTransaction((tx) => {
    tx.run(`DELETE FROM engagement_notes`);
    tx.run(`DELETE FROM client_models`);
    tx.run(`DELETE FROM engagements`);
    tx.run(`DELETE FROM clients`);
    tx.run(`DELETE FROM internal_clients`);
    tx.run(`UPDATE crn_sequence SET next_value = 1`);
    tx.run(`DELETE FROM app_migrations WHERE name LIKE ?`, [`${SEED_MARKER_PREFIX}%`]);
    for (const name of CUSTOM_PROJECT_TYPES) {
      tx.run(`DELETE FROM project_types WHERE name = ? COLLATE NOCASE AND role IS NULL`, [name]);
    }
  });

  // Seed accounts, their presence/activity, and the mock roster. Real accounts stay.
  const seedIds = (await queryUsers<{ id: string }>(`SELECT id FROM users WHERE is_seed = 1`)).map(r => r.id);
  const idList = seedIds.map(() => '?').join(', ');
  const mockMembers = Object.keys(teamMemberOffices);
  await executeUsers(
    `DELETE FROM team_members WHERE display_name IN (${mockMembers.map(() => '?').join(', ')})
       ${seedIds.length ? `OR user_id IN (${idList})` : ''}`,
    [...mockMembers, ...seedIds]
  );
  await executeUsers(`DELETE FROM users WHERE is_seed = 1`);
  await executeActivity(`DELETE FROM activity_logs WHERE user_agent = 'seed-script'`);
  if (seedIds.length) await executeActivity(`DELETE FROM user_presence WHERE user_id IN (${idList})`, seedIds);

  // portfolio.sqlite is a projection of client_models, which is now empty.
  await executePortfolio(`DELETE FROM portfolio_models`);

  console.log('  Previous mock data removed.');
  return true;
}

// =============================================================================
// Part A — engagements.sqlite: clients, engagements, notes, registries, links
// =============================================================================
async function seedEngagements(usersByDisplay: Map<string, KnownUser>) {
  console.log(`Seeding ${clients.length} clients and ${engagements.length} mock engagements...`);
  const pending = new Set(pendingCrnClients);

  /** Creator of a mock row: the linked account if the member has one. */
  const creatorOf = (e: MockEngagement): { id: string | null; name: string } => {
    if (!e.createdByDisplay) return { id: null, name: 'Seed' };
    const u = usersByDisplay.get(e.createdByDisplay);
    return u ? { id: u.id, name: u.name } : { id: null, name: e.createdByDisplay };
  };

  // Note authors: active seed accounts (never the real user's own account).
  const authors = Array.from(usersByDisplay.values()).filter(u => u.isSeed && u.status === 'active');

  let inserted = 0;
  let extraNotes = 0;
  await executeTransaction((tx) => {
    // Clients must exist before engagements (client_crn foreign key).
    for (const c of clients) {
      tx.run(
        `INSERT INTO clients (crn, name, crn_pending, created_by_name) VALUES (?, ?, ?, ?)`,
        [c.crn, c.name, pending.has(c.crn) ? 1 : 0, 'Seed']
      );
    }

    for (const e of engagements) {
      const dateStarted = parseDisplayDate(e.dateStarted);
      const dateFinished = e.dateFinished === '—' ? null : parseDisplayDate(e.dateFinished);
      const creator = creatorOf(e);

      // Completed client projects (not Ad-Hoc touch-points) get a source folder.
      const filepath =
        e.intakeType !== 'Ad-Hoc' && e.status === 'Completed'
          ? `\\\\fileserver\\Projects\\${e.clientCrn}\\${e.id}`
          : null;

      tx.run(
        `INSERT INTO engagements (
          id, client_crn, internal_client_name, internal_client_dept,
          intake_type, ad_hoc_channel, type, team_members, office, department,
          date_started, date_finished, status, portfolio_logged, portfolio_unchanged, portfolio,
          nna, nna_allocations, nna_notes, notes, tickers_mentioned, team, filepath, linked_from_id,
          created_by_id, created_by_name, project_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.clientCrn,
          e.internalClient.name,
          e.internalClient.clientDept,
          e.intakeType,
          e.adHocChannel ?? null,
          e.type,
          JSON.stringify(e.teamMembers),
          e.id === flagship?.id ? FLAGSHIP_OFFICE : e.office ?? null,
          e.department,
          dateStarted,
          dateFinished,
          e.status,
          e.portfolioLogged ? 1 : 0,
          e.portfolioUnchanged ? 1 : 0,
          e.portfolio ? JSON.stringify(e.portfolio) : null,
          e.nna ?? null,
          e.nnaAllocations?.length ? JSON.stringify(e.nnaAllocations) : null,
          e.nnaNotes ?? null,
          e.notes ?? null,
          e.tickersMentioned ? JSON.stringify(e.tickersMentioned) : null,
          teamName(e.team),
          filepath,
          e.linkedFromId ?? null,
          creator.id,
          creator.name,
          e.projectId ?? null,
        ]
      );
      inserted++;
    }

    // Record which ids the seed owns, so a later --reset can tell them apart from
    // interactions created in the app.
    const maxId = engagements.reduce((m, e) => Math.max(m, e.id), 0);
    tx.run(`INSERT OR REPLACE INTO app_migrations (name) VALUES (?)`, [`${SEED_MARKER_PREFIX}${maxId}`]);

    // The custom (admin-added) project type gets a real color before the generic
    // backfill below would give it the neutral default.
    for (const name of CUSTOM_PROJECT_TYPES) {
      tx.run(
        `INSERT OR IGNORE INTO project_types (id, name, color, sort_order, role) VALUES (lower(hex(randomblob(16))), ?, '#6366f1', 50, NULL)`,
        [name]
      );
    }

    // Backfill the managed registries from the freshly-inserted engagement data.
    // These are the same idempotent statements bootstrap() runs — but bootstrap
    // fires before any rows exist, so we re-run them here where they have data.
    tx.run(
      `INSERT OR IGNORE INTO internal_clients (id, name, department, created_by_name)
       SELECT lower(hex(randomblob(16))), internal_client_name, internal_client_dept, 'Seed'
       FROM (SELECT DISTINCT internal_client_name, internal_client_dept FROM engagements)
       WHERE internal_client_name IS NOT NULL AND trim(internal_client_name) != ''`
    );
    tx.run(
      `INSERT OR IGNORE INTO departments (id, name, color, sort_order)
       SELECT lower(hex(randomblob(16))), internal_client_dept, '#71717a', 100
       FROM (SELECT DISTINCT internal_client_dept FROM engagements)
       WHERE internal_client_dept IS NOT NULL AND trim(internal_client_dept) != ''`
    );
    tx.run(
      `INSERT OR IGNORE INTO intake_types (id, name, color, sort_order, role)
       SELECT lower(hex(randomblob(16))), intake_type, '#71717a', 100, NULL
       FROM (SELECT DISTINCT intake_type FROM engagements)
       WHERE intake_type IS NOT NULL AND trim(intake_type) != ''`
    );
    tx.run(
      `INSERT OR IGNORE INTO project_types (id, name, color, sort_order, role)
       SELECT lower(hex(randomblob(16))), type, '#71717a', 100, NULL
       FROM (SELECT DISTINCT type FROM engagements)
       WHERE type IS NOT NULL AND trim(type) != ''`
    );

    // Note history — step 1: copy every legacy free-text note into the append-only
    // log (same statement bootstrap uses). Run BEFORE the extra-note pass below so
    // its "engagement has no notes yet" guard still matches these engagements.
    tx.run(
      `INSERT INTO engagement_notes (engagement_id, note_text, author_name, author_id, created_at)
       SELECT id, notes, 'Imported Note', 'system', CURRENT_TIMESTAMP
       FROM engagements
       WHERE notes IS NOT NULL AND notes != ''
         AND id NOT IN (SELECT DISTINCT engagement_id FROM engagement_notes)`
    );

    // Note history — step 2: ~1/5 of engagements get a short multi-author thread,
    // and open / Follow Up work gets a longer running thread (4-5 entries), so the
    // note log UI and noteCount have real data.
    if (authors.length) {
      for (const e of engagements) {
        const longThread = e.status !== 'Completed' && e.id % 3 === 0;
        if (!longThread && e.id % 5 !== 0) continue;
        const start = new Date(parseDisplayDate(e.dateStarted));
        const n = longThread ? 4 + (e.id % 2) : (e.id % 2) + 1;
        for (let k = 0; k < n; k++) {
          const author = authors[(e.id + k) % authors.length];
          const text = EXTRA_NOTES[(e.id * 3 + k) % EXTRA_NOTES.length];
          const at = new Date(start);
          at.setDate(at.getDate() + k * 2);
          if (at > new Date()) at.setTime(Date.now() - (n - k) * 3600_000);
          const stamp = `${at.toISOString().split('T')[0]} ${k % 2 ? '14:30:00' : '09:15:00'}`;
          tx.run(
            `INSERT INTO engagement_notes (engagement_id, note_text, author_name, author_id, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [e.id, text, author.name, author.id, stamp]
          );
          extraNotes++;
        }
      }
    }
  });

  const linked = engagements.filter(e => e.linkedFromId).length;
  const withNna = engagements.filter(e => e.nna !== undefined).length;
  console.log(`  ${inserted} engagements inserted (+${extraNotes} extra note entries).`);
  console.log(`  ${withNna} with NNA, ${linked} linked to a prior interaction (funnel), ${pending.size} CRN-pending clients.`);
}

const EXTRA_NOTES = [
  '<p>Followed up by phone; client confirmed the updated allocation looks good.</p>',
  '<p>Circulated the revised deck to the wider team ahead of the review.</p>',
  '<p>Client asked for a side-by-side vs. their <strong>current benchmark</strong> — queued for next week.</p>',
  '<p>Logged the final numbers after the data refresh completed.</p>',
  '<p>Quick sync: no blockers, proceeding to the implementation step.</p>',
  '<ul><li>Sent holdings file</li><li>Waiting on custodian statement</li></ul>',
  '<p>Rescheduled the meeting — advisor out of office until next Tuesday.</p>',
  '<p>Compliance signed off on the proposal language.</p>',
];

// =============================================================================
// Part A (cont.) — client_models: multiple model portfolios per client
// =============================================================================
const EQUITY_TICKERS = ['VTI', 'VOO', 'VEA', 'VWO', 'VGT', 'SCHD', 'FMAC', 'FMAS', 'FMEV', 'AAPL', 'MSFT', 'NVDA'];
const ESG_TICKERS = ['ESGU', 'ESGV', 'SUSA', 'DSI', 'FMEV'];
const FIXED_TICKERS = ['BND', 'AGG', 'LQD', 'TLT', 'MUB', 'BNDX', 'IEF', 'SHY', 'TIP'];
const ALT_TICKERS = ['VNQ', 'GLD', 'DBC'];
const CASH_TICKERS = ['VMFXX', 'SPAXX'];
const CRYPTO_TICKERS = ['IBIT', 'FBTC'];
const MULTI_TICKERS = ['AOR', 'AOA'];
const FOF_TICKERS = ['FOF'];

function assetClassOf(ticker: string): AssetClass {
  if (FIXED_TICKERS.includes(ticker)) return 'Fixed Income';
  if (ALT_TICKERS.includes(ticker)) return 'Alternatives';
  if (CASH_TICKERS.includes(ticker)) return 'Cash';
  if (CRYPTO_TICKERS.includes(ticker)) return 'Crypto';
  if (MULTI_TICKERS.includes(ticker)) return 'Multi-Asset';
  if (FOF_TICKERS.includes(ticker)) return 'Fund of Funds';
  return 'Equity';
}

function pickDistinct(pool: string[], seed: number, n: number): string[] {
  const out: string[] = [];
  let attempt = 0;
  while (out.length < n && attempt < 100) {
    const t = pool[Math.floor(rng(seed + attempt) * pool.length)];
    if (!out.includes(t)) out.push(t);
    attempt++;
  }
  return out;
}

type ModelStyle = 'balanced' | 'growth' | 'conservative' | 'income' | 'esg';

/** Synthesize a holdings set. `replaceClientModels` normalizes weights to sum to 1. */
function synthHoldings(seed: number, style: ModelStyle): PortfolioHolding[] {
  const mix = {
    growth: { eq: 4, fi: 1, eqBudget: 85, fiBudget: 15 },
    conservative: { eq: 2, fi: 3, eqBudget: 60, fiBudget: 40 },
    income: { eq: 1, fi: 4, eqBudget: 25, fiBudget: 75 },
    esg: { eq: 4, fi: 2, eqBudget: 70, fiBudget: 30 },
    balanced: { eq: 3, fi: 2, eqBudget: 60, fiBudget: 40 },
  }[style];
  const holdings: PortfolioHolding[] = [];
  for (const t of pickDistinct(style === 'esg' ? ESG_TICKERS : EQUITY_TICKERS, seed, mix.eq)) {
    holdings.push({ identifier: t, constituentType: 'Security', assetClass: 'Equity', weight: mix.eqBudget / mix.eq });
  }
  for (const t of pickDistinct(FIXED_TICKERS, seed + 50, mix.fi)) {
    holdings.push({ identifier: t, constituentType: 'Security', assetClass: assetClassOf(t), weight: mix.fiBudget / mix.fi });
  }
  // Every model carries a small cash sleeve so the Cash class is broadly seeded.
  holdings.push({
    identifier: 'CASH', constituentType: 'Cash', assetClass: 'Cash', weight: 5,
  });
  // ~60% of models additionally run a newer-class sleeve — rotating Crypto /
  // Multi-Asset / Fund of Funds so each class ends up with real rows across the
  // client set. Weights are renormalized to sum to 1 by replaceClientModels.
  if (rng(seed + 91) > 0.4) {
    const extras = [
      { pool: CRYPTO_TICKERS, cls: 'Crypto' as const },
      { pool: MULTI_TICKERS, cls: 'Multi-Asset' as const },
      { pool: FOF_TICKERS, cls: 'Fund of Funds' as const },
    ];
    const pick = extras[Math.floor(rng(seed + 92) * extras.length)];
    holdings.push({
      identifier: pick.pool[Math.floor(rng(seed + 93) * pick.pool.length)],
      constituentType: 'Security', assetClass: pick.cls, weight: 4,
    });
  }
  return holdings;
}

function seededAum(seed: number): number {
  const tiers = [10_000_000, 25_000_000, 50_000_000, 100_000_000, 250_000_000, 500_000_000];
  return tiers[Math.floor(rng(seed) * tiers.length)];
}

/** ISO "YYYY-MM-DD" for a now-relative date `days` before today. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

async function seedClientModels() {
  // Prefer each client's most-recent logged portfolio as its main model, so the
  // main model matches real logged data where it exists.
  const legacyByCrn = new Map<string, { id: number; holdings: PortfolioHolding[]; loggedAt: string }>();
  const engagedCrns = new Set<string>();
  for (const e of engagements) {
    engagedCrns.add(e.clientCrn);
    if (e.clientCrn && e.portfolio && e.portfolio.length) {
      const prev = legacyByCrn.get(e.clientCrn);
      if (!prev || e.id > prev.id) {
        // Log the main model against the interaction where the portfolio was
        // captured, so its "logged" date matches real (now-relative) data.
        legacyByCrn.set(e.clientCrn, { id: e.id, holdings: e.portfolio, loggedAt: parseDisplayDate(e.dateStarted) });
      }
    }
  }

  // Pin the flagship's main model to the interaction that carries its Brokerage
  // department and office, overriding the most-recent-portfolio rule above, so the
  // >$1B AUM below lands on an interaction the acceptance query can actually find.
  if (flagship?.portfolio?.length) {
    legacyByCrn.set(flagship.clientCrn, {
      id: flagship.id,
      holdings: flagship.portfolio,
      loggedAt: parseDisplayDate(flagship.dateStarted),
    });
  }

  const newCrns = new Set(newClientCrns);
  const pendingCrns = new Set(pendingCrnClients);
  let modelCount = 0;
  let multiModelClients = 0;
  let clientsWithModels = 0;
  for (let idx = 0; idx < clients.length; idx++) {
    const c = clients[idx];
    const seed = (idx + 1) * 13;
    const legacy = legacyByCrn.get(c.crn);
    const isFlagship = c.crn === flagship?.clientCrn;

    // Registered-but-idle clients have no models; about half of the CRN-pending
    // clients have logged one so far (the rest only when a portfolio was captured).
    if (!engagedCrns.has(c.crn)) continue;
    if (pendingCrns.has(c.crn) && !legacy && idx % 2 === 0) continue;

    const models: Array<{ name: string; isMain: boolean; aum?: number; holdings: PortfolioHolding[]; loggedAt?: string }> = [
      {
        name: 'Core Model', isMain: true, aum: isFlagship ? FLAGSHIP_AUM : seededAum(seed),
        holdings: legacy?.holdings ?? synthHoldings(seed, 'balanced'),
        // Prefer the source interaction's date; else a now-relative logged date.
        loggedAt: legacy?.loggedAt ?? isoDaysAgo(Math.floor(rng(seed) * 120) + 5),
      },
    ];
    // New and pending relationships only have their first model so far.
    if (!newCrns.has(c.crn) && !pendingCrns.has(c.crn)) {
      if (idx % 5 < 2) {
        // ~40% of clients also run an equity-tilted growth model.
        models.push({ name: 'Growth Model', isMain: false, aum: seededAum(seed + 7), holdings: synthHoldings(seed + 7, 'growth'), loggedAt: isoDaysAgo(Math.floor(rng(seed + 7) * 150) + 10) });
      }
      if (idx % 5 === 0) {
        // ~20% additionally run a 60/40 — AUM intentionally left blank to exercise
        // the "unknown AUM" path.
        models.push({ name: 'Conservative 60/40', isMain: false, holdings: synthHoldings(seed + 11, 'conservative'), loggedAt: isoDaysAgo(Math.floor(rng(seed + 11) * 180) + 15) });
      }
      if (idx % 7 === 3) {
        models.push({ name: 'Income Model', isMain: false, aum: seededAum(seed + 17), holdings: synthHoldings(seed + 17, 'income'), loggedAt: isoDaysAgo(Math.floor(rng(seed + 17) * 200) + 20) });
      }
      if (idx % 9 === 4) {
        models.push({ name: 'ESG Tilt', isMain: false, aum: seededAum(seed + 19), holdings: synthHoldings(seed + 19, 'esg'), loggedAt: isoDaysAgo(Math.floor(rng(seed + 19) * 90) + 7) });
      }
    }

    // Attribute the client's models to the interaction their portfolio was captured
    // in, so the export shows that project's ID. Clients with no such interaction stay
    // unattributed and export a blank Project ID — the real default for existing data.
    await replaceClientModels(c.crn, models, legacy?.id ?? null);
    modelCount += models.length;
    clientsWithModels++;
    if (models.length > 1) multiModelClients++;
  }

  console.log(`  ${modelCount} client models across ${clientsWithModels} clients (${multiModelClients} with >1 model).`);
}

// =============================================================================
// Part B — users.sqlite: org lists, users, team members
// =============================================================================
async function seedUsersAndActivity() {
  const seededCount = await queryUsers<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE is_seed = 1');
  if (Number(seededCount[0]?.c ?? 0) > 0) {
    console.log('Seed users already present. Skipping user seed.');
    return;
  }
  console.log('Seeding mock users and team members...');

  // Org lists: the working teams plus the read-only ones, and both offices.
  const teams = [...MOCK_TEAMS.map(t => teamName(t) as string), ...READ_ONLY_TEAMS];
  for (const team of teams) {
    await executeUsers(`INSERT OR IGNORE INTO teams (id, name) VALUES (?, ?)`, [randomUUID(), team]);
  }
  for (const office of ['Office A', 'Office B']) {
    await executeUsers(`INSERT OR IGNORE INTO offices (id, name) VALUES (?, ?)`, [randomUUID(), office]);
  }

  // Rank titles, highest first — the same default list a real workspace starts
  // with. Insert then set sort_order so the demo ranks are correct even over the
  // bootstrap defaults.
  const TITLES = DEFAULT_TITLES;
  for (let i = 0; i < TITLES.length; i++) {
    await executeUsers(`INSERT OR IGNORE INTO titles (id, name, sort_order) VALUES (?, ?, ?)`, [randomUUID(), TITLES[i], i]);
    await executeUsers(`UPDATE titles SET sort_order = ? WHERE name = ? COLLATE NOCASE`, [i, TITLES[i]]);
  }

  // All seeded accounts share one demo password (meets the signup policy: >=10
  // chars, letter + number). is_seed = 1 keeps them out of the first-admin count.
  const passwordHash = await hashPassword('SeedPass123');
  for (const u of SEED_USERS) {
    await executeUsers(
      `INSERT INTO users (id, email, first_name, last_name, title, department, team, office, role, status, password_hash, is_seed, created_at, approved_at)
       VALUES (?, ?, ?, ?, ?, 'Default', ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)`,
      [
        randomUUID(), emailOf(u), u.first, u.last, u.title, teamName(u.team), u.office, u.role, u.status,
        passwordHash, u.status === 'pending' ? null : new Date().toISOString(),
      ]
    );
  }

  // Team members (the mock roster), linked to an account where one exists —
  // including the real account behind "Eli F.". Title: the linked user's, else a
  // rotating demo title.
  const usersByDisplay = await loadUsersByDisplay();
  const titleByDisplay = new Map(SEED_USERS.filter(u => u.display).map(u => [u.display as string, u.title]));
  const existing = new Set(
    (await queryUsers<{ display_name: string }>(`SELECT display_name FROM team_members`)).map(r => r.display_name)
  );
  let memberIndex = 0;
  for (const [display, office] of Object.entries(teamMemberOffices)) {
    if (existing.has(display)) continue;
    const [first, ...rest] = display.split(' ');
    const last = rest.join(' ') || first;
    const title = titleByDisplay.get(display) ?? TITLES[(memberIndex + 2) % TITLES.length];
    memberIndex += 1;
    await executeUsers(
      `INSERT INTO team_members (id, display_name, first_name, last_name, title, team, office, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(), display, first, last, title, teamName(teamMemberTeams[display]), office,
        inactiveMembers.includes(display) ? 'inactive' : 'active',
        usersByDisplay.get(display)?.id ?? null,
      ]
    );
  }

  console.log(`  ${SEED_USERS.length} users, ${Object.keys(teamMemberOffices).length} team members.`);
}

// =============================================================================
// Part C — activity.sqlite: a month of activity feed + presence
// =============================================================================
async function seedActivityLogs(usersByDisplay: Map<string, KnownUser>) {
  const actors = Array.from(usersByDisplay.values()).filter(u => u.isSeed && u.status === 'active');
  if (!actors.length) return;

  const recent = engagements.filter(e => e.dateStarted && Date.now() - new Date(e.dateStarted).getTime() < 30 * 86400000);
  const pick = <T,>(list: T[], i: number): T => list[i % list.length];
  const templates: Array<(i: number) => { action: string; et: string | null; eid: string | null; details: object | null }> = [
    () => ({ action: 'auth.login', et: null, eid: null, details: null }),
    (i) => { const e = pick(recent, i); return { action: 'engagement.create', et: 'engagement', eid: String(e.id), details: { type: e.type } }; },
    (i) => { const e = pick(recent, i * 3); return { action: 'engagement.update', et: 'engagement', eid: String(e.id), details: { status: e.status } }; },
    (i) => { const e = pick(recent, i * 5); return { action: 'engagement.status_change', et: 'engagement', eid: String(e.id), details: { to: e.status } }; },
    (i) => { const e = pick(recent.filter(r => r.nna !== undefined).concat(recent), i); return { action: 'engagement.nna_change', et: 'engagement', eid: String(e.id), details: { nna: e.nna ?? 0 } }; },
    (i) => { const e = pick(recent.filter(r => r.team === null).concat(recent), i); return { action: 'engagement.assign', et: 'engagement', eid: String(e.id), details: null }; },
    (i) => { const e = pick(recent, i * 7); return { action: 'note.create', et: 'engagement', eid: String(e.id), details: null }; },
    (i) => ({ action: 'client.create', et: 'client', eid: pick(pendingCrnClients.concat(newClientCrns), i), details: null }),
    () => ({ action: 'kpi.report', et: null, eid: null, details: { subject: 'team' } }),
    () => ({ action: 'engagement.export', et: null, eid: null, details: null }),
    () => ({ action: 'user.update', et: 'user', eid: null, details: { status: 'active' } }),
    () => ({ action: 'auth.signup', et: 'user', eid: null, details: { firstUser: false } }),
    () => ({ action: 'client.update', et: 'client', eid: pendingCrnClients[0], details: { crnPending: true } }),
  ];

  const count = 40;
  for (let i = 0; i < count; i++) {
    const a = templates[i % templates.length](i);
    const u = actors[(i * 7) % actors.length];
    // Spread from a few minutes ago back ~29 days.
    const minutesAgo = 3 + Math.round((i / count) * 29 * 24 * 60 + rng(i + 5) * 180);
    await executeActivity(
      `INSERT INTO activity_logs (id, timestamp, user_id, user_email, user_name, user_office, action, entity_type, entity_id, details, ip, user_agent)
       VALUES (?, datetime('now', ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), `-${minutesAgo} minutes`, u.id, u.email, u.name, u.office, a.action, a.et, a.eid,
        a.details ? JSON.stringify(a.details) : null, '127.0.0.1', 'seed-script']
    );
  }

  // Presence — a few users "online" (last_seen within the 5-minute window).
  for (const u of actors.slice(0, 3)) {
    await executeActivity(
      `INSERT OR REPLACE INTO user_presence (user_id, user_email, user_name, last_seen)
       VALUES (?, ?, ?, datetime('now', '-2 minutes'))`,
      [u.id, u.email, u.name]
    );
  }
  console.log(`  ${count} activity logs, ${Math.min(3, actors.length)} online users.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
