/**
 * =============================================================================
 * Portfolio Trends Sync
 * =============================================================================
 *
 * Rebuilds portfolio.sqlite from client_models, so the Portfolio Trends query
 * ("Brokerage models over $1B logged out of a given office") resolves against that
 * one file with no cross-database join. Idempotent — safe to re-run.
 *
 * The work lives in app/lib/db/portfolioSync.ts; this is just the CLI.
 *
 * Usage:
 *   npm run sync:portfolio
 *
 * Requires SQLITE_DIR to be set (via .env or environment).
 * =============================================================================
 */

// Load .env before anything else
import { config } from 'dotenv';
config({ path: '.env' });

import { hasDb } from '../app/lib/db';
import { syncPortfolio } from '../app/lib/db/portfolioSync';

async function main() {
  if (!hasDb()) {
    console.error('ERROR: SQLITE_DIR is not set. Point it at the folder holding the .sqlite files.');
    process.exit(1);
  }

  console.log('\nCRM Dashboard — Portfolio Trends Sync\n');

  const { models, clients, noOffice, noAum, backfill } = await syncPortfolio();

  if (backfill.filled || backfill.unresolved) {
    console.log(`  Office backfill: ${backfill.filled} interaction(s) filled, ${backfill.unresolved} unresolved.`);
  } else {
    console.log('  Office backfill: nothing to do.');
  }

  console.log(`  Synced ${models} model(s) across ${clients} client(s) into portfolio.sqlite.`);

  // These rows exist but can never satisfy an office- or AUM-filtered query. Say so
  // out loud — silently dropping them would read as "nothing matched" downstream.
  if (noOffice > 0) console.log(`  ${noOffice} model(s) have no logging office (excluded from office filters).`);
  if (noAum > 0) console.log(`  ${noAum} model(s) have no AUM (excluded from AUM thresholds).`);

  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('Portfolio sync failed:', err);
  process.exit(1);
});
