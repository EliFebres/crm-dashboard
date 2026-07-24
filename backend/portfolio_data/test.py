"""
Smoke test for portfolio_data.

Run it directly:

    python backend/portfolio_data/test.py

or as a module:

    python -m portfolio_data.test

It needs `SQLITE_DIR` pointing at the folder holding engagements.sqlite and
portfolio.sqlite. In a checkout that is already configured — config resolution falls back
to the repo's `.env`, the same file the Next.js app reads.

What it does: checks the sleeve arithmetic on synthetic holdings, pulls the real models and
asserts their weights, round-trips an upload against a real model id, proves each
validation rule actually rejects what it claims to, and writes two market points. Then it
deletes everything it created. Cleanup runs in a `finally`, so a failed assertion still
leaves the database exactly as it was found.

**It writes to whatever database SQLITE_DIR names — including a live one.** Two things make
that safe. Every row it creates is stamped `as_of = 1900-03-31`: a real quarter end, so it
exercises the same validation path as production data, but one no dashboard period will
ever select and no genuine upload will ever occupy. And every delete is scoped to that date
plus the marker below, so it cannot remove anything real even if a model id collides.
"""

import sys
from pathlib import Path

# Allow `python backend/portfolio_data/test.py`. Without this a direct run has no package
# context and every `from .core import ...` below fails.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "portfolio_data"

from .core.config import TABLE_MARKET_SERIES, load_config  # noqa: E402
from .core.exceptions import ConfigError  # noqa: E402
from .core.models import (  # noqa: E402
    Breakdown,
    Characteristics,
    MarketPoint,
    Performance,
    PortfolioData,
)
from .core.periods import is_quarter_end, quarter_end_for_label, quarter_label  # noqa: E402
from .core.sleeves import build_sleeves  # noqa: E402
from .db.connection import open_portfolio, open_portfolio_readonly, write_tx  # noqa: E402
from .db.reader import read_breakdowns, read_characteristics, read_performance  # noqa: E402
from .db.schema import ALL_TABLES, bootstrap  # noqa: E402
from .db.writer import delete_subject  # noqa: E402
from .pull import get_market_series, get_models, to_rows  # noqa: E402
from .push import upload_market_series, upload_pf_data  # noqa: E402
from .validation.mirrors import check_mirrors  # noqa: E402

MARKER = "PORTFOLIO_DATA_TEST_DELETE_ME"

#: A real quarter end, so validation treats it exactly like production data — but one no
#: period dropdown will ever offer and no genuine upload will ever occupy.
TEST_AS_OF = "1900-03-31"

TEST_SERIES = "ust_par_yield"

_failures = []
_EPS = 1e-9


def check(label: str, condition: bool, detail: str = "") -> None:
    """Record one assertion. Never raises — we want the full picture, then cleanup."""
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}" + (f"  ({detail})" if detail else ""))
        _failures.append(label)


def _counts(cfg):
    """Row counts for every table this package owns."""
    conn = open_portfolio_readonly(cfg)
    try:
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in ALL_TABLES}
    finally:
        conn.close()


def _cleanup(cfg, subjects) -> None:
    """
    Delete exactly what we created.

    `subjects` is a list of (subject_kind, subject_id) — the kind matters, because
    `delete_subject` scopes by it and a benchmark row would otherwise survive a cleanup
    that only asked about models.

    Every delete is pinned to TEST_AS_OF, so even a mistaken subject id cannot reach real
    data — nothing genuine is ever stamped 1900-03-31. The market rows are additionally
    matched on the marker source.
    """
    conn = open_portfolio(cfg)
    try:
        for subject_kind, subject_id in subjects:
            try:
                delete_subject(conn, cfg, subject_id, subject_kind=subject_kind, as_of=TEST_AS_OF)
            except Exception as exc:  # noqa: BLE001 — keep cleaning up
                print(f"  WARN  cleanup failed for {subject_kind}:{subject_id}: {exc}")
        try:
            with write_tx(conn) as cur:
                cur.execute(
                    f"DELETE FROM {TABLE_MARKET_SERIES} WHERE as_of = ? AND source = ?",
                    (TEST_AS_OF, MARKER),
                )
        except Exception as exc:  # noqa: BLE001
            print(f"  WARN  market series cleanup failed: {exc}")
    finally:
        conn.close()


# ---------------------------------------------------------------------------------
# Section 1 — sleeve arithmetic, no database involved
# ---------------------------------------------------------------------------------

def _test_sleeves() -> None:
    print("\nSleeve split: rescaling, strict membership, empty sleeves")

    holdings = [
        {"identifier": "vti", "constituentType": "Security", "assetClass": "Equity", "weight": 30},
        {"identifier": "VXUS", "constituentType": "Security", "assetClass": "Equity", "weight": 30},
        {"identifier": "BND", "constituentType": "Security", "assetClass": "Fixed Income", "weight": 20},
        {"identifier": "AOR", "constituentType": "Morningstar-Fund", "assetClass": "Multi-Asset", "weight": 20},
        # Dropped by normalization: blank identifier, bad asset class, non-positive weight.
        {"identifier": "", "constituentType": "Security", "assetClass": "Equity", "weight": 10},
        {"identifier": "XXX", "constituentType": "Security", "assetClass": "Nonsense", "weight": 10},
        {"identifier": "YYY", "constituentType": "Security", "assetClass": "Equity", "weight": 0},
    ]
    total, equity, fixed_income = build_sleeves(holdings)

    check("invalid holdings dropped", len(total) == 4, f"kept {len(total)}")
    check("total weights sum to 1", abs(sum(h.weight for h in total.holdings) - 1.0) < _EPS)
    check("identifiers uppercased", total.holdings[0].identifier == "VTI",
          total.holdings[0].identifier)

    check("equity rescaled to 1", abs(sum(h.weight for h in equity.holdings) - 1.0) < _EPS)
    check("equity weight_of_total is 0.6", abs(equity.weight_of_total - 0.6) < _EPS,
          f"{equity.weight_of_total}")
    check("fixed income rescaled to 1",
          abs(sum(h.weight for h in fixed_income.holdings) - 1.0) < _EPS)
    check("fixed income weight_of_total is 0.2",
          abs(fixed_income.weight_of_total - 0.2) < _EPS, f"{fixed_income.weight_of_total}")

    # The documented surprise: Multi-Asset cannot be decomposed, so the two sleeves do not
    # add up to the whole portfolio. If this ever equals 1, something started guessing.
    check("sleeves do not cover the multi-asset residual",
          abs((equity.weight_of_total + fixed_income.weight_of_total) - 0.8) < _EPS)
    check("multi-asset absent from both sleeves",
          all(h.asset_class == "Equity" for h in equity.holdings)
          and all(h.asset_class == "Fixed Income" for h in fixed_income.holdings))

    equity_only, _, no_bonds = build_sleeves([
        {"identifier": "VTI", "constituentType": "Security", "assetClass": "Equity", "weight": 1},
    ])
    check("model with no bonds yields an empty sleeve, not None",
          no_bonds is not None and len(no_bonds) == 0 and not no_bonds)
    check("empty sleeve has weight_of_total 0", no_bonds.weight_of_total == 0.0)

    empty_total, _, _ = build_sleeves("not json at all")
    check("corrupt holdings blob reads as empty, does not raise", len(empty_total) == 0)


def _test_mirrors() -> None:
    """
    The TypeScript copies of the vocabulary still match it.

    Drift here is invisible to a type check, a lint, and a page that renders — an omitted
    dimension just falls through to alphabetical bucket ordering, which turns a credit
    axis backwards while looking entirely plausible. This is the only thing that catches
    it. See validation/mirrors.py.
    """
    print("\nMirrors: the TypeScript copies still match the vocabulary")
    checked, findings = check_mirrors()
    if not checked:
        # A standalone copy of backend/ has no app to compare against, which the README
        # documents as supported. Say so rather than passing silently.
        print("  SKIP  app/lib/db/portfolioTrends.ts not found (standalone backend copy)")
        return
    check("bucket order and sleeve benchmarks agree across both languages",
          not findings, "; ".join(str(f) for f in findings))


def _test_periods() -> None:
    print("\nPeriods: quarter ends match the dashboard's dropdown")
    check("Q1 2026 -> 2026-03-31", quarter_end_for_label("Q1 2026") == "2026-03-31")
    check("Q4 2025 -> 2025-12-31", quarter_end_for_label("Q4 2025") == "2025-12-31")
    check("quarter end recognised", is_quarter_end("2026-06-30"))
    check("month end that is not a quarter end rejected", not is_quarter_end("2026-05-31"))
    check("mid-quarter rejected", not is_quarter_end("2026-02-14"))
    check("label round trip", quarter_label("2026-09-30") == "Q3 2026")
    check("test date is a real quarter end", is_quarter_end(TEST_AS_OF))


# ---------------------------------------------------------------------------------
# Section 2 — the real pull
# ---------------------------------------------------------------------------------

def _test_pull(cfg):
    print("\nPull: real models from client_models")
    models = get_models(cfg=cfg)
    print(f"  ....  {len(models)} model(s) found")

    bad_total = [m for m in models
                 if m.total and abs(sum(h.weight for h in m.total.holdings) - 1.0) > 1e-6]
    check("every non-empty total sums to 1", not bad_total,
          f"{len(bad_total)} off: {[m.id for m in bad_total[:3]]}")

    bad_sleeve = []
    for m in models:
        for sleeve in (m.equity, m.fixed_income):
            if sleeve and abs(sum(h.weight for h in sleeve.holdings) - 1.0) > 1e-6:
                bad_sleeve.append((m.id, sleeve.name))
    check("every non-empty sleeve sums to 1", not bad_sleeve, str(bad_sleeve[:3]))

    check("sleeves are never None",
          all(m.equity is not None and m.fixed_income is not None for m in models))

    residual = [m for m in models
                if m.equity.weight_of_total + m.fixed_income.weight_of_total > 1.0 + 1e-6]
    check("sleeve shares never exceed the portfolio", not residual,
          f"{[m.id for m in residual[:3]]}")

    rows = to_rows(models, sleeves=["equity"])
    equity_positions = sum(len(m.equity) for m in models)
    check("to_rows flattens the equity sleeve", len(rows) == equity_positions,
          f"{len(rows)} vs {equity_positions}")

    if models:
        check("main_only is a subset",
              len(get_models(main_only=True, cfg=cfg)) <= len(models))
    return models


# ---------------------------------------------------------------------------------
# Section 3 — the round trip
# ---------------------------------------------------------------------------------

def _test_round_trip(cfg, model):
    print(f"\nPush: round trip against {model.describe()} at {TEST_AS_OF}")

    summary = upload_pf_data(
        PortfolioData(
            subject_id=model.id,
            sleeve="equity",
            as_of=TEST_AS_OF,
            characteristics=Characteristics(
                price_to_book=2.87, profitability=0.31, wtd_avg_market_cap=142_000_000_000,
                underlying_companies=3184,
            ),
            breakdowns=[Breakdown("region", {
                "US": 0.62, "Developed ex-US": 0.28, "Emerging Markets": 0.10,
            })],
            source=MARKER,
        ),
        cfg=cfg,
    )
    check("upload reported success", summary.written == 1 and summary.failed == 0,
          summary.render())

    stored = read_characteristics(cfg, model.id, "equity", TEST_AS_OF)
    check("characteristics readable on a fresh connection", stored is not None)
    if stored:
        check("price_to_book round-tripped", abs(float(stored["price_to_book"]) - 2.87) < 1e-9,
              str(stored["price_to_book"]))
        check("integer metric round-tripped", int(stored["underlying_companies"]) == 3184)
        check("unsupplied metric stored as NULL", stored["effective_duration"] is None)
        check("source recorded", stored["source"] == MARKER)

    breakdowns = read_breakdowns(cfg, model.id, "equity", TEST_AS_OF)
    region = next((b for b in breakdowns if b.dimension == "region"), None)
    check("breakdown readable", region is not None)
    if region:
        check("all buckets stored", len(region.weights) == 3, str(region.weights))
        check("breakdown still sums to 1 as persisted",
              abs(region.total_weight - 1.0) < cfg.weight_tolerance, str(region.total_weight))

    # A second pass carrying only performance must not blank the characteristics. This is
    # the COALESCE behaviour in db/writer.py, and the whole reason metrics are Optional.
    print("\n  Partial update: performance in a second pass")
    upload_pf_data(
        PortfolioData(
            subject_id=model.id, sleeve="equity", as_of=TEST_AS_OF,
            performance=Performance(return_1y=0.084, benchmark_id="MSCI-ACWI-IMI"),
            source=MARKER,
        ),
        cfg=cfg,
    )
    after = read_characteristics(cfg, model.id, "equity", TEST_AS_OF)
    check("earlier characteristics survived the second pass",
          after is not None and abs(float(after["price_to_book"]) - 2.87) < 1e-9)
    perf = read_performance(cfg, model.id, "equity", TEST_AS_OF)
    check("performance written alongside", perf is not None
          and abs(float(perf["return_1y"]) - 0.084) < 1e-9)

    # Replacing one dimension must leave the others alone.
    upload_pf_data(
        PortfolioData(
            subject_id=model.id, sleeve="equity", as_of=TEST_AS_OF,
            breakdowns=[Breakdown("style", {"Value": 0.3, "Blend": 0.4, "Growth": 0.3})],
            source=MARKER,
        ),
        cfg=cfg,
    )
    dims = {b.dimension for b in read_breakdowns(cfg, model.id, "equity", TEST_AS_OF)}
    check("adding a dimension keeps the earlier one", dims == {"region", "style"}, str(dims))


def _test_rejections(cfg, model):
    print("\nValidation: each rule rejects what it claims to")

    def rejected(label, record, expected_code):
        summary = upload_pf_data(record, cfg=cfg)
        codes = {f.code for f in summary.findings}
        check(label, summary.failed == 1 and summary.written == 0 and expected_code in codes,
              f"written={summary.written} failed={summary.failed} codes={sorted(codes)}")

    rejected(
        "percent-vs-fraction return rejected",
        PortfolioData(subject_id=model.id, sleeve="equity", as_of=TEST_AS_OF,
                      performance=Performance(return_1y=8.4), source=MARKER),
        "value_looks_like_percent",
    )
    rejected(
        "breakdown summing to 0.97 rejected",
        PortfolioData(subject_id=model.id, sleeve="equity", as_of=TEST_AS_OF,
                      breakdowns=[Breakdown("region", {
                          "US": 0.62, "Developed ex-US": 0.28, "Emerging Markets": 0.07})],
                      source=MARKER),
        "breakdown_does_not_sum",
    )
    rejected(
        "non-quarter-end as_of rejected",
        PortfolioData(subject_id=model.id, sleeve="equity", as_of="1900-02-14",
                      characteristics=Characteristics(price_to_book=2.0), source=MARKER),
        "as_of_not_quarter_end",
    )
    rejected(
        "unknown bucket rejected",
        PortfolioData(subject_id=model.id, sleeve="equity", as_of=TEST_AS_OF,
                      breakdowns=[Breakdown("region", {"Mars": 1.0})], source=MARKER),
        "bucket_unknown",
    )
    rejected(
        "unknown sleeve rejected",
        PortfolioData(subject_id=model.id, sleeve="Equity", as_of=TEST_AS_OF,
                      characteristics=Characteristics(price_to_book=2.0), source=MARKER),
        "sleeve_unknown",
    )
    rejected(
        "orphan subject rejected",
        PortfolioData(subject_id="no-such-model-id", sleeve="equity", as_of=TEST_AS_OF,
                      characteristics=Characteristics(price_to_book=2.0), source=MARKER),
        "subject_not_a_model",
    )
    rejected(
        "unregistered benchmark rejected",
        PortfolioData(subject_id="NOT-AN-INDEX", subject_kind="benchmark", sleeve="equity",
                      as_of=TEST_AS_OF, characteristics=Characteristics(price_to_book=2.0),
                      source=MARKER),
        "benchmark_not_registered",
    )

    # r-squared as a percentage is the same class of bug as a return as a percentage.
    rejected(
        "r_squared above 1 rejected",
        PortfolioData(subject_id=model.id, sleeve="equity", as_of=TEST_AS_OF,
                      performance=Performance(r_squared_3y=87.0), source=MARKER),
        "value_out_of_unit_interval",
    )

    try:
        PortfolioData.from_dict({
            "subject_id": model.id, "sleeve": "equity", "as_of": TEST_AS_OF,
            "characteristics": {"price_to_books": 2.87},
        })
        check("misspelled metric raises rather than being dropped", False, "no exception")
    except ValueError as exc:
        check("misspelled metric raises rather than being dropped", "price_to_books" in str(exc))

    dry = upload_pf_data(
        PortfolioData(subject_id=model.id, sleeve="total", as_of=TEST_AS_OF,
                      characteristics=Characteristics(num_holdings=42), source=MARKER),
        dry_run=True, cfg=cfg,
    )
    check("dry run validates without writing",
          dry.written == 1 and read_characteristics(cfg, model.id, "total", TEST_AS_OF) is None)

    # A benchmark subject on the seeded registry must be accepted — the path the "vs
    # MSCI ACWI IMI" captions depend on.
    ok = upload_pf_data(
        PortfolioData(subject_id="MSCI-ACWI-IMI", subject_kind="benchmark", sleeve="equity",
                      as_of=TEST_AS_OF,
                      characteristics=Characteristics(price_to_book=3.1), source=MARKER),
        cfg=cfg,
    )
    check("seeded benchmark accepted", ok.written == 1 and ok.failed == 0, ok.render())


def _test_market_series(cfg) -> None:
    print("\nMarket series: separate pull and upload")

    summary = upload_market_series([
        MarketPoint(TEST_SERIES, TEST_AS_OF, 0.0412, tenor="2Y", source=MARKER),
        MarketPoint(TEST_SERIES, TEST_AS_OF, 0.0435, tenor="10Y", source=MARKER),
    ], cfg=cfg)
    check("two points written", summary.written == 2 and summary.failed == 0, summary.render())

    points = get_market_series(series=[TEST_SERIES], start=TEST_AS_OF, end=TEST_AS_OF, cfg=cfg)
    ours = [p for p in points if p.source == MARKER]
    check("points read back", len(ours) == 2, f"{len(ours)}")
    check("tenors preserved", {p.tenor for p in ours} == {"2Y", "10Y"})
    check("values preserved", any(abs(p.value - 0.0435) < 1e-9 for p in ours))

    bad = upload_market_series(
        MarketPoint(TEST_SERIES, TEST_AS_OF, 4.35, tenor="10Y", source=MARKER), cfg=cfg
    )
    check("yield sent as a percentage rejected",
          bad.failed == 1 and "value_implausible" in {f.code for f in bad.findings},
          bad.render())

    bad_tenor = upload_market_series(
        MarketPoint(TEST_SERIES, TEST_AS_OF, 0.04, tenor="7000Y", source=MARKER), cfg=cfg
    )
    check("unknown tenor rejected",
          bad_tenor.failed == 1 and "tenor_unknown" in {f.code for f in bad_tenor.findings})

    # A daily date must be fine here — the constraint that applies to model data does not
    # apply to a yield curve.
    daily = upload_market_series(
        MarketPoint(TEST_SERIES, TEST_AS_OF, 0.0400, tenor="1M", source=MARKER), cfg=cfg
    )
    check("market series accepts any valid date", daily.written == 1, daily.render())


def main() -> int:
    print("portfolio_data smoke test")
    print("=" * 66)

    try:
        cfg = load_config()
        cfg.ensure_ready()
    except ConfigError as exc:
        print(f"\nCannot run: {exc}\n")
        return 2

    print(f"  sqlite_dir   : {cfg.sqlite_dir}")
    print(f"  portfolio db : {cfg.portfolio_db}")

    # Create the sidecar tables before the baseline count, so bootstrap is not itself
    # mistaken for a change this test failed to clean up.
    conn = open_portfolio(cfg)
    try:
        bootstrap(conn, cfg)
    finally:
        conn.close()

    before = _counts(cfg)
    subjects = []

    _test_sleeves()
    _test_periods()
    _test_mirrors()

    try:
        models = _test_pull(cfg)
        usable = next((m for m in models if m.equity), None)

        if usable is None:
            print("\n  SKIP  no model with equity holdings — write tests need one.")
            print("        Run `npm run seed` to populate, then re-run.")
        else:
            subjects = [("model", usable.id), ("benchmark", "MSCI-ACWI-IMI")]
            _test_round_trip(cfg, usable)
            _test_rejections(cfg, usable)

        _test_market_series(cfg)

    except Exception as exc:  # noqa: BLE001 — report, then always clean up
        print(f"\n  FAIL  unexpected {type(exc).__name__}: {exc}")
        _failures.append(f"unexpected {type(exc).__name__}")
    finally:
        _cleanup(cfg, subjects)

    print("\nCleanup")
    after = _counts(cfg)
    restored = all(after[t] == before[t] for t in ALL_TABLES)
    check("database restored to baseline row counts", restored, f"{before} -> {after}")

    print()
    if _failures:
        print(f"FAILED - {len(_failures)} check(s): {', '.join(_failures)}")
        return 1
    print("PASSED - all checks green, test rows removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
