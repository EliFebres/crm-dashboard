# portfolio_data

Pull logged client models out of the CRM, push their characteristics and performance back in.

You write the code that *runs the analytics*. This package owns everything on either side of
that: splitting each model into the portfolios an analytics engine can actually consume,
validating what comes back, writing it where the dashboard reads, and proving it landed.

Pure standard library — no third-party dependencies. Python 3.9+.

---

## Why this exists

The Portfolio Trends dashboard is fully built and completely inert. Every analytics card
renders a "requires market data" placeholder, because
[`portfolioTrends.ts`](../../../app/lib/db/portfolioTrends.ts) says the store holds
identifiers, asset class, constituent type and weight — and no market data. Market cap,
price-to-book, profitability, duration, credit rating, yield and maturity all need a
security master the app does not have.

This package is the round trip that fills that gap.

```
get_models()  ──►  your analytics engine  ──►  upload_pf_data()
     ▲                                                │
client_models                                  portfolio.sqlite
(engagements.sqlite)                          (what the dashboard reads)
```

---

## Install

```
pip install -e backend              # puts `portfolio_data` on sys.path; installs nothing
npm run sync:portfolio              # creates portfolio.sqlite if it doesn't exist yet
python -m portfolio_data.test       # smoke test: pulls, pushes, verifies, cleans up
```

`SQLITE_DIR` — the folder holding `engagements.sqlite` and `portfolio.sqlite` — is resolved
by `crm_sync` from a real environment variable or the same `.env` the Next.js app reads,
nearest-first. In a checkout there is nothing to set up. See
[crm_sync's README](../../crm_sync/docs/README.md#where-sqlite_dir-comes-from) for the
search order and how to override it.

Everything else tunable lives in [`core/config.py`](../core/config.py): validation
thresholds, strictness, and whether to verify after writing.

---

## Pulling models

```python
from portfolio_data import get_models

for model in get_models():
    analyse_equity(model.equity.identifiers)         # style, market cap, region
    analyse_bonds(model.fixed_income.identifiers)    # duration, credit, maturity
```

Each model comes back as **three portfolios**:

| Sleeve | Contents | Weights |
|---|---|---|
| `model.total` | every holding | sum to 1.0, as logged |
| `model.equity` | `Equity` holdings only | **rescaled** to sum to 1.0 |
| `model.fixed_income` | `Fixed Income` holdings only | **rescaled** to sum to 1.0 |

The split is the whole point. An equity style analysis run over a portfolio that is 38%
bonds produces a price-to-book that describes nothing real, and a duration computed over
the whole thing is diluted by every share of stock in it.

### Two things that surprise people

**Sleeve membership is strict, so the sleeves don't add up to the portfolio.**
`Alternatives`, `Crypto`, `Fund of Funds`, `Multi-Asset` and `Cash` appear only in `total`.
A Multi-Asset fund genuinely holds both stocks and bonds, and splitting it needs look-through
data this store does not have — guessing would put invented numbers in both sleeves. So:

```python
model.equity.weight_of_total + model.fixed_income.weight_of_total   # usually < 1
```

`weight_of_total` is the sleeve's share of the portfolio — the number rescaling destroys,
and the one you need to weight a sleeve-level statistic back up to portfolio level.

**An empty sleeve is a `Sleeve`, never `None`.** Plenty of models are 100% equity. You get
`holdings=()` and `weight_of_total=0.0`, so iterating is always safe and `if model.equity:`
does what it looks like.

### Filters

All optional, all ANDed together:

```python
get_models(
    crn="CRN-000042",              # one client
    model_ids=[...],               # re-pull a specific batch
    departments=["Brokerage"],     # from the logging interaction
    offices=["Chicago"],
    teams=["Team A"],
    min_aum=1_000_000_000,         # strict lower bound, in dollars
    main_only=True,                # each client's main model — the "Avg. Client" cohort
    logged_since="2026-01-01",
)
```

`min_aum` matches the dashboard's "over $1B" semantics exactly, including the part people
forget: a model whose AUM was never entered satisfies **no** threshold, because SQL excludes
NULL from a comparison. Those exclusions are logged rather than left to read as "nothing
matched".

### Flattening

`to_rows()` gives you one row per (model, sleeve, holding) — the shape a CSV, a DataFrame
or a request body actually wants:

```python
from portfolio_data import get_models, to_rows

rows = to_rows(get_models(), sleeves=["equity"])
# {'model_id': ..., 'sleeve': 'equity', 'identifier': 'VTI', 'weight': 0.42,
#  'weight_of_total': 0.6, 'asset_class': 'Equity', 'client_name': ..., ...}
```

`weight * weight_of_total` is the position's true portfolio weight.

---

## Pushing results

```python
from portfolio_data import (PortfolioData, Characteristics, Performance, Breakdown,
                            upload_pf_data, quarter_end_for_label)

summary = upload_pf_data(PortfolioData(
    subject_id=model.id,                        # straight from get_models()
    sleeve="equity",
    as_of=quarter_end_for_label("Q1 2026"),     # -> "2026-03-31"
    characteristics=Characteristics(
        price_to_book=2.87,
        profitability=0.31,
        wtd_avg_market_cap=142_000_000_000,
        underlying_companies=3184,
    ),
    performance=Performance(return_1y=0.084, benchmark_id="MSCI-ACWI-IMI"),
    breakdowns=[
        Breakdown("region", {"US": 0.62, "Developed ex-US": 0.28, "Emerging Markets": 0.10}),
    ],
    source="Morningstar Direct 2026-04-02",
))

print(summary.render())
raise SystemExit(summary.exit_code)
```

Pass one record, an iterable of them, or plain dicts. Per-record failure isolation: one bad
record lands in the summary and the batch continues. Exit codes match crm_sync — `0` clean,
`1` some records failed, `3` everything failed.

**Always dry-run a new export first.** It runs the full validation matrix against live data
and writes nothing:

```python
summary = upload_pf_data(records, dry_run=True)
```

### Everything is a decimal fraction

8.4% is `0.084`. Not `8.4`. This applies to returns, alpha, drawdown, standard deviation,
tracking error, yields, expense ratio, and the capture ratios (`up_capture_3y=0.95`, not
`95`). Only genuinely unitless statistics — beta, Sharpe, R-squared, information ratio —
are stored as-is.

Validation rejects a value that looks like a percentage, because this is the one upload bug
that cannot be spotted afterwards: `840%` and `8.4%` look equally plausible sitting in a
database.

### Partial updates don't erase

A field left as `None` means *not measured* and is written as NULL. On a re-upload every
value column goes through `COALESCE(excluded.col, col)`, so a second pass carrying only
performance leaves the characteristics from the first pass intact. That makes the natural
workflow — characteristics from one export, returns from another — safe. To deliberately
clear a value, delete the row and re-upload it.

Breakdowns are the exception: each dimension you supply is **replaced wholesale**, because
buckets carry no stable identity and merging would leave a bucket that vanished upstream
still counted in the chart's total. Replacement is scoped to the dimensions you send —
uploading a fresh `region` does not touch a `credit_rating` written earlier.

### Benchmarks

Every card on the page is captioned "vs \<index\>", so benchmarks travel the same path and
live in the same tables — the comparison has to be one query, not a join across two shapes.

```python
upload_pf_data(PortfolioData(
    subject_id="MSCI-ACWI-IMI",
    subject_kind="benchmark",
    sleeve="equity",
    as_of=quarter_end_for_label("Q1 2026"),
    characteristics=Characteristics(price_to_book=3.10),
))
```

`MSCI-ACWI-IMI` and `BBG-US-AGG` are seeded into `pf_benchmarks` automatically. Any other id
must be registered there first — an unregistered benchmark is rejected, because a typo'd
index would otherwise become a subject nothing ever compares against.

---

## Market series

Treasury par yields and credit spreads belong to the market, not to anybody's portfolio, so
they get their own pull and upload:

```python
from portfolio_data import MarketPoint, get_market_series, upload_market_series

# What do I already have?
have = {p.as_of for p in get_market_series(series=["ig_oas"])}

upload_market_series([
    MarketPoint("ust_par_yield", "2026-03-31", 0.0412, tenor="2Y"),
    MarketPoint("ust_par_yield", "2026-03-31", 0.0435, tenor="10Y"),
    MarketPoint("ig_oas",        "2026-03-31", 94.0),          # basis points, no tenor
])
```

Unlike model data, `as_of` here is **not** constrained to quarter ends — a yield curve is
naturally daily and the credit-spread card plots a history.

Known series, their tenors and their units live in
[`validation/vocabulary.py`](../validation/vocabulary.py).

---

## Why every model date must be a quarter end

The page builds its period dropdown from `getRecentQuarterEnds`, which emits labels for
*completed* quarters only — "Q1 2026", "Q4 2025". Those labels are the entire set of periods
anyone can select.

So a row stamped `2026-02-14` is not merely unusual, it is **unreachable**: no dropdown entry
resolves to it, no query asks for it, and it sits in the table forever looking fine. Hence
`quarter_end_for_label("Q1 2026")` — it cannot produce a date the dropdown won't offer.

```python
from portfolio_data import quarter_end_for_label, recent_quarter_ends

quarter_end_for_label("Q1 2026")   # '2026-03-31'
recent_quarter_ends(8)             # the last 8 completed quarter ends, newest first
```

---

## The validation matrix, and what each check is for

Nothing about a successful `INSERT` tells you the data is usable. Every rule exists because
a specific value produces a specific **silent** failure — the write succeeds, nothing errors,
and the number is wrong or the row is invisible.

In strict mode (the default) an ERROR aborts the record before a transaction opens, so a bad
record costs nothing.

| Check | Why |
|---|---|
| `subject_id` exists in `client_models` | `client_models` is in another file, so there is no foreign key to fail. An orphan row is stored perfectly and joined by nothing, ever. |
| Benchmark is registered in `pf_benchmarks` | A typo'd index becomes a subject nothing compares against, and the "vs …" caption resolves to nothing. |
| `sleeve` is one of the three literals | The dashboard filters on the exact string. `'Equity'` instead of `'equity'` is stored fine and matched by no query. |
| `as_of` is ISO **and a quarter end** | See above — an unreachable row. |
| Returns look like fractions | `8.4` meaning 8.4% renders as 840% with no complaint from anything. |
| Breakdown weights sum to 1.0 ± tolerance | A chart that quietly does not reach 100%. |
| Buckets are in the dimension's vocabulary | An unrecognized bucket renders as a slice with no legend entry. |
| `r_squared` within [0, 1] | Same percent-vs-fraction trap, different field. |
| Non-negative where negative is impossible | A negative market cap inverts an axis rather than erroring. Deliberately short: P/E, duration and profitability all go legitimately negative. |
| Equity metrics on a bond sleeve (or vice versa) | **WARN.** Usually a column shifted by one in the export, but occasionally defensible. |
| A payload carrying nothing at all | **WARN.** It would write nothing and still report success. |

**After the commit**, [`db/verify.py`](../db/verify.py) re-reads each row through a *fresh,
read-only connection*. That is the point: it proves the row is durable and visible to **other
processes**, which is what the Next.js server is. Verifying through the connection that wrote
it would prove only that the writer remembers writing.

---

## Where the data goes

Models are read from **`client_models`** in `engagements.sqlite` — the source of truth, never
stale. `portfolio_models` in `portfolio.sqlite` is a projection rebuilt by
`npm run sync:portfolio` and stale in between, so a pull that fed analytics from it would
silently analyse whatever the world looked like at the last sync.

Uploads land in **`portfolio.sqlite`**, beside `portfolio_models`, because that is where the
dashboard reads. `portfolio_models.id` reuses `client_models.id`, so the ids line up with no
translation.

| Table | Shape | Holds |
|---|---|---|
| `pf_characteristics` | wide, one column per metric | market cap, P/B, profitability, duration, yields |
| `pf_performance` | wide | trailing returns, risk and relative statistics |
| `pf_breakdowns` | `(dimension, bucket, weight)` | region, style box, credit rating, security type, maturity |
| `pf_benchmarks` | registry | what a benchmark id means |
| `pf_market_series` | `(series, tenor, as_of, value)` | Treasury curve, credit spreads |

All five are keyed by `(subject_kind, subject_id, sleeve, as_of)` — except the last two,
which are market-level.

**Wide vs narrow.** Characteristics and performance are wide: one typed column per metric.
The column lists are not written out anywhere — they are reflected from the dataclasses in
[`core/models.py`](../core/models.py), so adding a field adds the column and its upsert slot
with no second edit. A hand-kept list drifts, and the symptom of drift is an upload that
accepts a value and silently never stores it. Breakdowns stay narrow because a distribution
is naturally `(dimension, bucket, weight)`, the bucket set differs per dimension, and a
9-cell style box would otherwise be nine columns meaningless to every other dimension.

### These tables are sidecars

The Next.js app creates `portfolio.sqlite` and bootstraps `portfolio_models` and
`portfolio_holdings` on every open. Its bootstrap runs `CREATE TABLE IF NOT EXISTS` against
exactly the tables it knows about, so five extra tables beside them are inert — it will never
drop them, migrate them, or notice them. That is the same arrangement `crm_sync` uses for
`crm_sync_keys`, and it is what lets this package add analytics without touching the app's
schema. Running `npm run sync:portfolio` leaves everything here untouched.

### Orphans

`subject_id` points at `client_models`, which lives in a different file — SQLite cannot
enforce a foreign key across files. So a model deleted in the dashboard leaves its analytics
behind, quietly inflating every rollup that counts rows.

```python
from portfolio_data import prune_orphans

prune_orphans()                 # dry run: reports what it would remove
prune_orphans(dry_run=False)    # actually removes it
```

Benchmarks are never orphans; they have no model row by design.

---

## Concurrency, and why there's no password

Both are inherited from `crm_sync` and its reasoning applies here unchanged: this package
opens the SQLite files directly as a local process, so the security control is the OS
permissions on `SQLITE_DIR`, not an application credential — there is no network boundary to
authenticate across.

Writes use `PRAGMA busy_timeout = 5000` (matching better-sqlite3), an explicit
`BEGIN IMMEDIATE` rather than Python's deferred default, and retry with exponential backoff
and jitter. See
[crm_sync/db/connection.py](../../crm_sync/db/connection.py) for the full account of the
three `sqlite3` defaults that would otherwise corrupt or deadlock this.

---

## Files

Three files at the root are the whole surface a user needs. Everything else is internal.

| Module | Responsibility |
|---|---|
| `pull.py` | **`get_models()`**, `get_market_series()`, `to_rows()` |
| `push.py` | **`upload_pf_data()`**, `upload_market_series()`, `prune_orphans()` |
| `test.py` | Runnable smoke test: pulls, pushes, verifies, deletes what it created |
| `core/config.py` | Database name, table names, validation thresholds, strictness |
| `core/models.py` | The dataclasses — and, by reflection, the schema |
| `core/sleeves.py` | Asset-class split and weight rescaling |
| `core/periods.py` | Quarter-end arithmetic |
| `core/exceptions.py` | The `PortfolioDataError` hierarchy |
| `db/connection.py` | The one place this package couples to crm_sync |
| `db/schema.py` | The sidecar tables, created idempotently |
| `db/reader.py` | The `client_models` query, and every read-back |
| `db/writer.py` | The upsert transactions, and orphan pruning |
| `db/verify.py` | Post-write "is this readable?" assertions |
| `validation/rules.py` | The pre-write matrix |
| `validation/vocabulary.py` | Sleeves, dimensions, buckets, series, tenors |

---

## Values mirrored from the TypeScript side

Hand-maintained copies. If someone changes the original, change it here too.

| Here | There |
|---|---|
| `vocabulary.ASSET_CLASSES` | `app/lib/utils/portfolioHoldings.ts` → `ASSET_CLASSES` |
| `vocabulary.CONSTITUENT_TYPES` | `app/lib/utils/portfolioHoldings.ts` → `CONSTITUENT_TYPES` |
| `core/sleeves.normalize` | `app/lib/utils/portfolioHoldings.ts` → `normalizeHoldingWeights` |
| `core/sleeves.parse_holdings` | `app/lib/db/clientModels.ts` → `parseHoldings` |
| `core/periods.recent_quarter_ends` | `portfolio-trends/page.tsx` → `getRecentQuarterEnds` |
| `db/reader._MODELS_SQL` | `app/lib/db/portfolioSync.ts` → `syncPortfolioModels` |

---

## What reads this

The Portfolio Trends dashboard, via
[`app/lib/db/portfolioTrends.ts`](../../../app/lib/db/portfolioTrends.ts). It joins
`pf_characteristics` / `pf_breakdowns` to `portfolio_models` on `subject_id`, groups by
cohort, and returns `PortfolioTrendsResponse.marketData`. Which card consumes what:

| Table / dimension | Card |
|---|---|
| `pf_characteristics` equity group | Style XY, Profitability XY, Metrics vs Index |
| `pf_characteristics` FI group | FI Metrics, and the duration marker on the Yield Curve |
| `region` | vs MSCI ACWI IMI |
| `market_cap`, `style`, `profitability` | Style × Profitability |
| `credit_rating` | Credit Breakdown |
| `security_type` | Security Type |
| `maturity_band` | Maturity Breakdown |
| `ust_par_yield` | Yield Curve |
| `ig_oas`, `hy_oas` | Credit Spread |
| `pf_performance` | *nothing yet* — stored and queryable, but no card plots returns |

Two behaviours worth knowing when your upload does not show up:

- **The period dropdown is built from the `as_of` values that exist**, not from the
  calendar. Upload a quarter and it appears; upload nothing and the dashboard says
  "requires market data" rather than offering an empty quarter.
- **A period with no data falls back to the newest that has some**, and the page says so
  in the data strip. So a lagging upload degrades to "showing Q1 2026" rather than to a
  blank page.

A dimension nobody uploaded leaves *its own card* in the placeholder state while the rest
of the page renders — the fallback is per-card, not per-page.

To see it all working on a dev database, `python backend/seed_portfolio_analytics.py`
writes plausible (invented, `source = 'DEMO SEED'`) analytics for every logged model;
`--clear` removes exactly those rows.
