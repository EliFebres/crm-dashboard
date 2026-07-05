/**
 * =============================================================================
 * SQLite Seed Script
 * =============================================================================
 *
 * Creates the database schema (via the app's own bootstrap) and optionally
 * populates it with mock data for development/testing.
 *
 * `--with-mock` fills EVERY table the dashboard reads, not just clients +
 * engagements: multiple model portfolios per client (with a main flag + AUM),
 * an append-only note history with multiple authors, the internal-client
 * registry, project filepaths, funnel parent/child links, plus a set of mock
 * users, team members, activity logs and presence rows.
 *
 * Usage:
 *   npx tsx scripts/seed-db.ts              # Create schema only
 *   npx tsx scripts/seed-db.ts --with-mock  # Schema + seed with mock data
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
import { engagements, clients, teamMemberOffices } from '../app/lib/data/engagements';
import { replaceClientModels } from '../app/lib/db/clientModels';
import { queryUsers, executeUsers, DEFAULT_TITLES } from '../app/lib/db/users';
import { executeActivity } from '../app/lib/db/activity';
import { hashPassword } from '../app/lib/auth/password';
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
  const countRows = await query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM engagements');
  console.log('Schema ready.');

  const withMock = process.argv.includes('--with-mock');
  if (!withMock) {
    console.log('Done. Run with --with-mock to populate with mock data.');
    return;
  }

  // Guard on BOTH tables: a client created via the app UI (with no engagements
  // yet) would otherwise slip past an engagements-only check and then crash the
  // seed transaction on the clients.name UNIQUE index.
  const existingCount = Number(countRows[0]?.cnt ?? 0);
  const clientRows = await query<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM clients');
  const existingClients = Number(clientRows[0]?.cnt ?? 0);
  if (existingCount > 0 || existingClients > 0) {
    console.log(
      `Database already has ${existingClients} client(s) and ${existingCount} engagement(s). Skipping engagement seed.`
    );
    console.log('To re-seed, delete the database files and run again.');
  } else {
    await seedEngagements();
    await seedClientModels();
  }

  // Users/activity are their own databases with their own emptiness guard, so
  // they seed independently of the engagement guard above.
  await seedUsersAndActivity();

  console.log('Done.');
}

// =============================================================================
// Part A — engagements.sqlite: clients, engagements, notes, registries, links
// =============================================================================
async function seedEngagements() {
  console.log(`Seeding ${clients.length} clients and ${engagements.length} mock engagements...`);

  // Funnel parent/child links: connect ~1/7 of client projects back to the most
  // recent prior interaction with the SAME client. Ids are deterministic and
  // ascend with date, so a parent id is always < its child id (already inserted).
  const linkedFrom = new Map<number, number>();
  const lastByCrn = new Map<string, number>();
  for (const e of engagements) {
    if (e.intakeType !== 'Ad-Hoc' && e.id % 7 === 0) {
      const prev = lastByCrn.get(e.clientCrn);
      if (prev !== undefined) linkedFrom.set(e.id, prev);
    }
    lastByCrn.set(e.clientCrn, e.id);
  }

  let inserted = 0;
  let extraNotes = 0;
  await executeTransaction((tx) => {
    // Clients must exist before engagements (client_crn foreign key).
    for (const c of clients) {
      tx.run(
        `INSERT INTO clients (crn, name, created_by_name) VALUES (?, ?, ?)`,
        [c.crn, c.name, 'Seed']
      );
    }

    for (const e of engagements) {
      const dateStarted = parseDisplayDate(e.dateStarted);
      const dateFinished = e.dateFinished === '—' ? null : parseDisplayDate(e.dateFinished);

      // Completed client projects (not Ad-Hoc touch-points) get a source folder.
      const filepath =
        e.intakeType !== 'Ad-Hoc' && e.status === 'Completed'
          ? `\\\\fileserver\\Projects\\${e.clientCrn}\\${e.id}`
          : null;

      tx.run(
        `INSERT INTO engagements (
          id, client_crn, internal_client_name, internal_client_dept,
          intake_type, ad_hoc_channel, type, team_members, department,
          date_started, date_finished, status, portfolio_logged, portfolio,
          nna, notes, tickers_mentioned, team, filepath, linked_from_id,
          created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id,
          e.clientCrn,
          e.internalClient.name,
          e.internalClient.clientDept,
          e.intakeType,
          e.adHocChannel ?? null,
          e.type,
          JSON.stringify(e.teamMembers),
          e.department,
          dateStarted,
          dateFinished,
          e.status,
          e.portfolioLogged ? 1 : 0,
          e.portfolio ? JSON.stringify(e.portfolio) : null,
          e.nna ?? null,
          e.notes ?? null,
          e.tickersMentioned ? JSON.stringify(e.tickersMentioned) : null,
          'Default Team',
          filepath,
          linkedFrom.get(e.id) ?? null,
          'Seed',
        ]
      );
      inserted++;
    }

    // Backfill the managed registries from the freshly-inserted engagement data.
    // These are the same idempotent statements bootstrap() runs — but bootstrap
    // fires before any rows exist, so we re-run them here where they have data.
    tx.run(
      `INSERT OR IGNORE INTO internal_clients (id, name, department)
       SELECT lower(hex(randomblob(16))), internal_client_name, internal_client_dept
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

    // Note history — step 2: give ~1/5 of engagements a richer multi-author thread
    // with staggered timestamps, so the note log UI and noteCount have real data.
    for (const e of engagements) {
      if (e.id % 5 !== 0) continue;
      const iso = parseDisplayDate(e.dateStarted);
      const times = ['09:00:00', '14:30:00'];
      const n = (e.id % 2) + 1; // 1 or 2 extra notes
      for (let k = 0; k < n; k++) {
        const author = NOTE_AUTHORS[(e.id + k) % NOTE_AUTHORS.length];
        const text = EXTRA_NOTES[(e.id * 3 + k) % EXTRA_NOTES.length];
        tx.run(
          `INSERT INTO engagement_notes (engagement_id, note_text, author_name, author_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [e.id, text, author.name, author.id, `${iso} ${times[k]}`]
        );
        extraNotes++;
      }
    }
  });

  console.log(`  ${inserted} engagements inserted (+${extraNotes} extra note entries).`);
  console.log(`  ${linkedFrom.size} engagements linked to a prior interaction (funnel).`);
}

const NOTE_AUTHORS = [
  { name: 'Avery Bennett', id: 'seed-author-1' },
  { name: 'Jordan Ellis', id: 'seed-author-2' },
  { name: 'Marlowe Reed', id: 'seed-author-3' },
  { name: 'Dakota Carter', id: 'seed-author-4' },
];

const EXTRA_NOTES = [
  'Followed up by phone; client confirmed the updated allocation looks good.',
  'Circulated the revised deck to the wider team ahead of the review.',
  'Client asked for a side-by-side vs. their current benchmark — queued for next week.',
  'Logged the final numbers after the data refresh completed.',
  'Quick sync: no blockers, proceeding to the implementation step.',
];

// =============================================================================
// Part A (cont.) — client_models: multiple model portfolios per client
// =============================================================================
const EQUITY_TICKERS = ['VTI', 'VOO', 'VEA', 'VWO', 'VGT', 'SCHD', 'FMAC', 'FMAS', 'FMEV', 'AAPL', 'MSFT', 'NVDA'];
const FIXED_TICKERS = ['BND', 'AGG', 'LQD', 'TLT', 'MUB', 'BNDX', 'IEF', 'SHY', 'TIP'];
const ALT_TICKERS = ['VNQ', 'GLD', 'DBC'];

function assetClassOf(ticker: string): AssetClass {
  if (FIXED_TICKERS.includes(ticker)) return 'Fixed Income';
  if (ALT_TICKERS.includes(ticker)) return 'Alternatives';
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

/** Synthesize a holdings set. `replaceClientModels` normalizes weights to sum to 1. */
function synthHoldings(seed: number, style: 'balanced' | 'growth' | 'conservative'): PortfolioHolding[] {
  const mix =
    style === 'growth'
      ? { eq: 4, fi: 1, eqBudget: 85, fiBudget: 15 }
      : style === 'conservative'
        ? { eq: 2, fi: 3, eqBudget: 60, fiBudget: 40 }
        : { eq: 3, fi: 2, eqBudget: 60, fiBudget: 40 };
  const holdings: PortfolioHolding[] = [];
  for (const t of pickDistinct(EQUITY_TICKERS, seed, mix.eq)) {
    holdings.push({ identifier: t, constituentType: 'Security', assetClass: 'Equity', weight: mix.eqBudget / mix.eq });
  }
  for (const t of pickDistinct(FIXED_TICKERS, seed + 50, mix.fi)) {
    holdings.push({ identifier: t, constituentType: 'Security', assetClass: assetClassOf(t), weight: mix.fiBudget / mix.fi });
  }
  return holdings;
}

function seededAum(seed: number): number {
  const tiers = [10_000_000, 25_000_000, 50_000_000, 100_000_000, 250_000_000, 500_000_000];
  return tiers[Math.floor(rng(seed) * tiers.length)];
}

async function seedClientModels() {
  // Prefer each client's most-recent logged portfolio as its main model, so the
  // main model matches real logged data where it exists.
  const legacyByCrn = new Map<string, { id: number; holdings: PortfolioHolding[] }>();
  for (const e of engagements) {
    if (e.clientCrn && e.portfolio && e.portfolio.length) {
      const prev = legacyByCrn.get(e.clientCrn);
      if (!prev || e.id > prev.id) legacyByCrn.set(e.clientCrn, { id: e.id, holdings: e.portfolio });
    }
  }

  let modelCount = 0;
  let multiModelClients = 0;
  for (let idx = 0; idx < clients.length; idx++) {
    const c = clients[idx];
    const seed = (idx + 1) * 13;
    const legacy = legacyByCrn.get(c.crn);

    const models: Array<{ name: string; isMain: boolean; aum?: number; holdings: PortfolioHolding[] }> = [
      { name: 'Core Model', isMain: true, aum: seededAum(seed), holdings: legacy?.holdings ?? synthHoldings(seed, 'balanced') },
    ];
    if (idx % 5 < 2) {
      // ~40% of clients also run an equity-tilted growth model.
      models.push({ name: 'Growth Model', isMain: false, aum: seededAum(seed + 7), holdings: synthHoldings(seed + 7, 'growth') });
    }
    if (idx % 5 === 0) {
      // ~20% additionally run a 60/40 — AUM intentionally left blank to exercise
      // the "unknown AUM" path.
      models.push({ name: 'Conservative 60/40', isMain: false, holdings: synthHoldings(seed + 11, 'conservative') });
    }

    await replaceClientModels(c.crn, models);
    modelCount += models.length;
    if (models.length > 1) multiModelClients++;
  }

  console.log(`  ${modelCount} client models across ${clients.length} clients (${multiModelClients} with >1 model).`);
}

// =============================================================================
// Part B — users.sqlite + activity.sqlite: users, team members, logs, presence
// =============================================================================
const SEED_USERS = [
  { first: 'Alex', last: 'Morgan', title: 'Head of Department', office: 'Office A', role: 'admin', status: 'active', display: 'Alex M.' },
  { first: 'Blake', last: 'Nguyen', title: 'Manager', office: 'Office A', role: 'user', status: 'active', display: 'Blake N.' },
  { first: 'Casey', last: 'Patel', title: 'Associate', office: 'Office A', role: 'user', status: 'active', display: 'Casey P.' },
  { first: 'Finley', last: 'Torres', title: 'Head of Team', office: 'Office B', role: 'user', status: 'active', display: 'Finley T.' },
  { first: 'Harper', last: 'Brooks', title: 'Analyst', office: 'Office B', role: 'user', status: 'pending', display: 'Harper B.' },
  { first: 'Indi', last: 'Chen', title: 'Associate', office: 'Office B', role: 'user', status: 'pending', display: null },
] as const;

async function seedUsersAndActivity() {
  const seededCount = await queryUsers<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE is_seed = 1');
  if (Number(seededCount[0]?.c ?? 0) > 0) {
    console.log('Seed users already present. Skipping user/activity seed.');
    return;
  }
  console.log('Seeding mock users, team members, activity and presence...');

  // Org lists (bootstrap already guarantees Default Team + Office A; add Office B).
  await executeUsers(`INSERT OR IGNORE INTO teams (id, name) VALUES (?, 'Default Team')`, [randomUUID()]);
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
  const userIdByDisplay = new Map<string, string>();
  const activeUsers: Array<{ id: string; email: string; name: string; office: string }> = [];

  for (const u of SEED_USERS) {
    const id = randomUUID();
    const email = `${u.first.toLowerCase()}.${u.last.toLowerCase()}@example.com`;
    if (u.status === 'active') {
      await executeUsers(
        `INSERT INTO users (id, email, first_name, last_name, title, department, team, office, role, status, password_hash, is_seed, created_at, approved_at)
         VALUES (?, ?, ?, ?, ?, 'Default', 'Default Team', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [id, email, u.first, u.last, u.title, u.office, u.role, u.status, passwordHash]
      );
      activeUsers.push({ id, email, name: `${u.first} ${u.last}`, office: u.office });
    } else {
      await executeUsers(
        `INSERT INTO users (id, email, first_name, last_name, title, department, team, office, role, status, password_hash, is_seed, created_at)
         VALUES (?, ?, ?, ?, ?, 'Default', 'Default Team', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [id, email, u.first, u.last, u.title, u.office, u.role, u.status, passwordHash]
      );
    }
    if (u.display) userIdByDisplay.set(u.display, id);
  }

  // Team members (the 12 mock members), linking the few that have a user account.
  // Give each a title: the linked user's title, else a rotating demo title.
  const titleByDisplay = new Map(SEED_USERS.filter(u => u.display).map(u => [u.display as string, u.title]));
  let memberIndex = 0;
  for (const [display, office] of Object.entries(teamMemberOffices)) {
    const [first, ...rest] = display.split(' ');
    const last = rest.join(' ') || first;
    const title = titleByDisplay.get(display) ?? TITLES[memberIndex % TITLES.length];
    memberIndex += 1;
    await executeUsers(
      `INSERT INTO team_members (id, display_name, first_name, last_name, title, team, office, status, user_id)
       VALUES (?, ?, ?, ?, ?, 'Default Team', ?, 'active', ?)`,
      [randomUUID(), display, first, last, title, office, userIdByDisplay.get(display) ?? null]
    );
  }

  // Activity feed — recent entries attributed to the active seeded users.
  const acts: Array<{ action: string; offset: string; et: string | null; eid: string | null; details: string | null }> = [
    { action: 'auth.login', offset: '-3 minutes', et: null, eid: null, details: null },
    { action: 'engagement.create', offset: '-2 hours', et: 'engagement', eid: '1', details: JSON.stringify({ type: 'Meeting' }) },
    { action: 'engagement.update', offset: '-5 hours', et: 'engagement', eid: '2', details: JSON.stringify({ status: 'Completed' }) },
    { action: 'client.create', offset: '-1 days', et: 'client', eid: 'MOCK-000001', details: null },
    { action: 'user.update', offset: '-2 days', et: 'user', eid: null, details: JSON.stringify({ status: 'active' }) },
    { action: 'auth.login', offset: '-3 days', et: null, eid: null, details: null },
    { action: 'engagement.create', offset: '-6 days', et: 'engagement', eid: '3', details: JSON.stringify({ type: 'Data Request' }) },
    { action: 'auth.signup', offset: '-10 days', et: 'user', eid: null, details: JSON.stringify({ firstUser: false }) },
  ];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    const u = activeUsers[i % activeUsers.length];
    await executeActivity(
      `INSERT INTO activity_logs (id, timestamp, user_id, user_email, user_name, user_office, action, entity_type, entity_id, details, ip, user_agent)
       VALUES (?, datetime('now', ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), a.offset, u.id, u.email, u.name, u.office, a.action, a.et, a.eid, a.details, '127.0.0.1', 'seed-script']
    );
  }

  // Presence — a couple of users "online" (last_seen within the 5-minute window).
  for (const u of activeUsers.slice(0, 3)) {
    await executeActivity(
      `INSERT OR REPLACE INTO user_presence (user_id, user_email, user_name, last_seen)
       VALUES (?, ?, ?, datetime('now', '-2 minutes'))`,
      [u.id, u.email, u.name]
    );
  }

  console.log(`  ${SEED_USERS.length} users, ${Object.keys(teamMemberOffices).length} team members, ${acts.length} activity logs.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
