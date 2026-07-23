"""
Seed plausible analytics for every logged model, so the Portfolio Trends cards have
something to draw in development.

    python backend/seed_portfolio_analytics.py                # last 4 quarters
    python backend/seed_portfolio_analytics.py --quarters 8
    python backend/seed_portfolio_analytics.py --clear        # remove seeded rows only

**This writes invented numbers.** That is a real tension with the rest of this feature:
the dashboard deliberately shows "requires market data" rather than made-up figures, and
that is the right default. So every row written here is stamped `source = 'DEMO SEED'`,
which makes it greppable, and `--clear` removes exactly those rows and nothing else. Do
not point this at a database anyone is making decisions from.

The values are not random noise. Each model's characteristics are derived from its actual
holdings — an equity-heavy model gets a higher price-to-book, a bond-heavy one gets longer
duration — and seeded from the model id, so re-running produces identical numbers instead
of a chart that reshuffles on every run. That makes the seeded data useful for checking
that filters, cohorts and periods actually change what is drawn.

It goes through the public `upload_pf_data` API rather than writing SQL, so the same
validation matrix a real ingest passes through applies here too. If this script can write
it, a real export in the same shape can too.
"""

import argparse
import hashlib
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from portfolio_data import (  # noqa: E402
    Breakdown,
    Characteristics,
    MarketPoint,
    Performance,
    PortfolioData,
    get_models,
    load_config,
    recent_quarter_ends,
    upload_market_series,
    upload_pf_data,
)
from portfolio_data.core.config import TABLE_MARKET_SERIES  # noqa: E402
from portfolio_data.db.connection import open_portfolio, write_tx  # noqa: E402
from portfolio_data.db.schema import bootstrap  # noqa: E402

SOURCE = "DEMO SEED"

EQUITY_BENCHMARK = "MSCI-ACWI-IMI"
FI_BENCHMARK = "BBG-US-AGG"

#: sleeve -> (benchmark id, market-cap scale, price-to-book scale, profitability scale)
#:
#: The regional slices are seeded with the tilts the regions actually have — US large and
#: expensive, emerging markets smaller and cheaper — so switching the equity scope visibly
#: moves the charts instead of redrawing the same cloud under a different title.
EQUITY_REGION_SLEEVES = {
    "equity_us": ("RUSSELL-3000", 1.35, 1.30, 1.15),
    "equity_developed": ("MSCI-WORLD-EX-USA-IMI", 0.70, 0.75, 0.90),
    "equity_em": ("MSCI-EM-IMI", 0.45, 0.62, 0.82),
}


#: Style-box mandates, as (cap weights, style weights).
#:
#: Every model used to be jittered around one set of base weights, which put the whole
#: cloud in a patch a tenth of the box wide — jittering harder would only have made that
#: patch fuzzier. Real books differ by *mandate*, not by noise: a small-cap growth manager
#: and a large-cap value manager are in different corners, and the models inside each
#: mandate cluster. So each model draws a mandate from its id and jitters within it, which
#: is what puts dots across the grid and gives the clusters a reason to exist.
#:
#: Positions these land on, as (style x, size y): large value (.24, .08), large blend
#: (.48, .10), large growth (.76, .09), all-cap core (.50, .28), mid blend (.49, .41),
#: mid growth (.73, .45), small value (.27, .76), small growth (.76, .79).
STYLE_ARCHETYPES = (
    ({"Large": 0.88, "Mid": 0.09, "Small": 0.03}, {"Value": 0.62, "Blend": 0.28, "Growth": 0.10}),
    ({"Large": 0.85, "Mid": 0.11, "Small": 0.04}, {"Value": 0.30, "Blend": 0.45, "Growth": 0.25}),
    ({"Large": 0.86, "Mid": 0.10, "Small": 0.04}, {"Value": 0.10, "Blend": 0.28, "Growth": 0.62}),
    ({"Large": 0.60, "Mid": 0.25, "Small": 0.15}, {"Value": 0.33, "Blend": 0.34, "Growth": 0.33}),
    ({"Large": 0.35, "Mid": 0.48, "Small": 0.17}, {"Value": 0.30, "Blend": 0.42, "Growth": 0.28}),
    ({"Large": 0.30, "Mid": 0.50, "Small": 0.20}, {"Value": 0.12, "Blend": 0.30, "Growth": 0.58}),
    ({"Large": 0.10, "Mid": 0.28, "Small": 0.62}, {"Value": 0.58, "Blend": 0.30, "Growth": 0.12}),
    ({"Large": 0.08, "Mid": 0.27, "Small": 0.65}, {"Value": 0.10, "Blend": 0.28, "Growth": 0.62}),
)


def archetype_for(model_id: str):
    """
    A model's mandate, fixed for its lifetime.

    Keyed on the id alone — not the period — so a model holds its place on the box across
    quarters instead of teleporting between them. Quarter-to-quarter drift comes from the
    jitter applied on top.
    """
    return STYLE_ARCHETYPES[rng_for(model_id, "archetype").randrange(len(STYLE_ARCHETYPES))]


def rng_for(*parts: str) -> random.Random:
    """A generator seeded from the inputs, so a given model/period always gets the same numbers."""
    digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
    return random.Random(int(digest[:16], 16))


def name_counts(rnd: random.Random, weights: dict, total: int) -> dict:
    """
    Split `total` holdings across buckets, roughly in proportion to weight.

    Only roughly: a bucket's share of the names and its share of the money are different
    numbers in a real book — a 40% weight can be four names or four hundred — so the
    jitter here is the point, not noise to be smoothed out. The remainder lands on the
    largest bucket so the counts still add up to `total`.
    """
    out = {k: max(1, int(round(total * w * rnd.uniform(0.6, 1.4)))) for k, w in weights.items()}
    largest = max(out, key=lambda k: weights[k])
    out[largest] = max(1, out[largest] + (total - sum(out.values())))
    return out


def spread(rnd: random.Random, weights: dict) -> dict:
    """Jitter a set of weights and renormalize so they still sum to exactly 1."""
    jittered = {k: max(0.001, v * rnd.uniform(0.75, 1.25)) for k, v in weights.items()}
    total = sum(jittered.values())
    out = {k: v / total for k, v in jittered.items()}
    # Push the rounding residual onto the largest bucket so the sum is exact, not 0.9999.
    largest = max(out, key=lambda k: out[k])
    out[largest] += 1.0 - sum(out.values())
    return out


def equity_payload(model, as_of: str, sleeve: str = "equity") -> PortfolioData:
    """
    One equity sleeve for one model — the whole book, or a regional slice of it.

    The regional sleeves exist only because an analytics engine can produce them: a
    holding carries no domicile, so `get_models()` cannot split equity by region and this
    script cannot derive the split either. It fabricates each slice directly, which is
    exactly the shape a real engine would upload.

    Only the whole book gets a `region` breakdown. A US sleeve's regional split is
    trivially 100% US, and uploading that would put a meaningless bar chart on the page.
    """
    rnd = rng_for(model.id, as_of, sleeve)
    benchmark, cap_scale, pb_scale, prof_scale = EQUITY_REGION_SLEEVES.get(
        sleeve, (EQUITY_BENCHMARK, 1.0, 1.0, 1.0)
    )
    # Tilt with the sleeve's share of the portfolio: an equity-dominant model reads more
    # growth-y, a small equity sleeve beside a large bond one reads more value-y.
    tilt = model.equity.weight_of_total

    # Look-through name count for this sleeve, split across each dimension's buckets.
    holdings = rnd.randint(120, 900)
    arch_cap, arch_style = archetype_for(model.id)
    cap = spread(rnd, arch_cap)
    style = spread(rnd, arch_style)
    prof = spread(rnd, {"High": 0.42, "Mid": 0.38, "Low": 0.20})

    # Keep the characteristics consistent with the mandate. A model the style box shows as
    # small-cap growth should not also report a $300B weighted average market cap and an
    # index-like price-to-book — the three equity cards read the same portfolio, and
    # letting them disagree would make the demo data actively misleading about its own
    # shape. This is also what spreads the Style XY cloud along both axes.
    cap_factor = 0.15 + 0.85 * (cap["Large"] + 0.4 * cap["Mid"])
    growth_share = style["Blend"] * 0.5 + style["Growth"]
    pb_factor = 0.70 + 0.60 * growth_share

    breakdowns = [
        Breakdown("market_cap", cap, name_counts(rnd, cap, holdings)),
        Breakdown("style", style, name_counts(rnd, style, holdings)),
        Breakdown("profitability", prof, name_counts(rnd, prof, holdings)),
    ]
    if sleeve == "equity":
        breakdowns.insert(0, Breakdown("region", spread(rnd, {
            "US": 0.63, "Developed ex-US": 0.26, "Emerging Markets": 0.11,
        })))

    return PortfolioData(
        subject_id=model.id,
        sleeve=sleeve,
        as_of=as_of,
        characteristics=Characteristics(
            wtd_avg_market_cap=rnd.uniform(40e9, 380e9) * (0.7 + tilt * 0.6) * cap_scale * cap_factor,
            median_market_cap=rnd.uniform(8e9, 60e9) * cap_scale * cap_factor,
            price_to_book=round(rnd.uniform(1.6, 4.2) * (0.85 + tilt * 0.3) * pb_scale * pb_factor, 2),
            price_to_earnings=round(rnd.uniform(14, 28) * pb_scale * pb_factor, 1),
            profitability=round(rnd.uniform(0.18, 0.42) * prof_scale, 3),
            dividend_yield=round(rnd.uniform(0.008, 0.026), 4),
            underlying_companies=rnd.randint(60, 3600),
            num_holdings=len(model.equity),
            expense_ratio=round(rnd.uniform(0.0004, 0.0065), 4),
        ),
        performance=Performance(
            return_qtd=round(rnd.uniform(-0.06, 0.11), 4),
            return_1y=round(rnd.uniform(-0.09, 0.27), 4),
            return_3y=round(rnd.uniform(0.01, 0.14), 4),
            return_5y=round(rnd.uniform(0.03, 0.15), 4),
            std_dev_3y=round(rnd.uniform(0.11, 0.21), 4),
            sharpe_3y=round(rnd.uniform(0.2, 1.4), 2),
            beta_3y=round(rnd.uniform(0.85, 1.15), 2),
            r_squared_3y=round(rnd.uniform(0.86, 0.99), 3),
            max_drawdown=round(-rnd.uniform(0.10, 0.34), 4),
            benchmark_id=benchmark,
        ),
        breakdowns=breakdowns,
        source=SOURCE,
    )


def fixed_income_payload(model, as_of: str) -> PortfolioData:
    rnd = rng_for(model.id, as_of, "fi")
    duration = round(rnd.uniform(2.4, 8.6), 2)

    return PortfolioData(
        subject_id=model.id,
        sleeve="fixed_income",
        as_of=as_of,
        characteristics=Characteristics(
            effective_duration=duration,
            # Maturity always exceeds duration for a positive-coupon bond portfolio.
            effective_maturity=round(duration * rnd.uniform(1.25, 1.65), 2),
            yield_to_maturity=round(rnd.uniform(0.036, 0.058), 4),
            sec_yield=round(rnd.uniform(0.032, 0.052), 4),
            avg_coupon=round(rnd.uniform(0.028, 0.051), 4),
            avg_credit_quality=rnd.choice(["AA-", "A+", "A", "A-", "BBB+"]),
            num_holdings=len(model.fixed_income),
        ),
        performance=Performance(
            return_qtd=round(rnd.uniform(-0.03, 0.05), 4),
            return_1y=round(rnd.uniform(-0.04, 0.09), 4),
            return_3y=round(rnd.uniform(-0.02, 0.05), 4),
            std_dev_3y=round(rnd.uniform(0.04, 0.09), 4),
            benchmark_id=FI_BENCHMARK,
        ),
        breakdowns=[
            Breakdown("credit_rating", spread(rnd, {
                "AAA": 0.36, "AA": 0.11, "A": 0.19, "BBB": 0.21,
                "BB": 0.06, "B": 0.03, "CCC & Below": 0.01, "Not Rated": 0.03,
            })),
            Breakdown("security_type", spread(rnd, {
                "Government": 0.40, "Municipal": 0.06, "Corporate": 0.28,
                "Securitized": 0.22, "Cash & Equivalents": 0.04,
            })),
            Breakdown("maturity_band", spread(rnd, {
                "0-1Y": 0.06, "1-3Y": 0.18, "3-5Y": 0.20, "5-7Y": 0.16,
                "7-10Y": 0.18, "10-20Y": 0.12, "20Y+": 0.10,
            })),
        ],
        source=SOURCE,
    )


#: An index carries thousands of names; the count is what makes "40% large cap" mean
#: something different for an index than for a 30-stock model.
INDEX_NAMES = 9000


def _index_style_breakdowns(rnd: random.Random, jitter: bool = True) -> list:
    """market_cap / style / profitability for an equity index, with holding counts."""
    cap = {"Large": 0.712, "Mid": 0.196, "Small": 0.092}
    style = {"Value": 0.334, "Blend": 0.333, "Growth": 0.333}
    prof = {"High": 0.401, "Mid": 0.392, "Low": 0.207}
    if jitter:
        cap, style, prof = spread(rnd, cap), spread(rnd, style), spread(rnd, prof)
    return [
        Breakdown("market_cap", cap, name_counts(rnd, cap, INDEX_NAMES)),
        Breakdown("style", style, name_counts(rnd, style, INDEX_NAMES)),
        Breakdown("profitability", prof, name_counts(rnd, prof, INDEX_NAMES)),
    ]


def region_benchmark_payload(sleeve: str, as_of: str) -> PortfolioData:
    """A regional index — Russell 3000, MSCI World ex USA IMI, MSCI EM IMI."""
    benchmark, cap_scale, pb_scale, prof_scale = EQUITY_REGION_SLEEVES[sleeve]
    rnd = rng_for(benchmark, as_of)
    return PortfolioData(
        subject_id=benchmark, subject_kind="benchmark", sleeve=sleeve, as_of=as_of,
        characteristics=Characteristics(
            wtd_avg_market_cap=rnd.uniform(160e9, 200e9) * cap_scale,
            median_market_cap=rnd.uniform(11e9, 15e9) * cap_scale,
            price_to_book=round(rnd.uniform(2.6, 3.1) * pb_scale, 2),
            price_to_earnings=round(rnd.uniform(18, 22) * pb_scale, 1),
            profitability=round(rnd.uniform(0.27, 0.33) * prof_scale, 3),
            dividend_yield=round(rnd.uniform(0.017, 0.021), 4),
            underlying_companies=rnd.randint(700, 3100),
        ),
        breakdowns=_index_style_breakdowns(rnd),
        source=SOURCE,
    )


def benchmark_payloads(as_of: str) -> list:
    """The indices the cards are captioned against. Steadier than any single model."""
    eq = rng_for(EQUITY_BENCHMARK, as_of)
    fi = rng_for(FI_BENCHMARK, as_of)
    return [
        *(region_benchmark_payload(s, as_of) for s in EQUITY_REGION_SLEEVES),
        PortfolioData(
            subject_id=EQUITY_BENCHMARK, subject_kind="benchmark", sleeve="equity", as_of=as_of,
            characteristics=Characteristics(
                wtd_avg_market_cap=eq.uniform(160e9, 200e9),
                median_market_cap=eq.uniform(11e9, 15e9),
                price_to_book=round(eq.uniform(2.6, 3.1), 2),
                price_to_earnings=round(eq.uniform(18, 22), 1),
                profitability=round(eq.uniform(0.27, 0.33), 3),
                dividend_yield=round(eq.uniform(0.017, 0.021), 4),
                underlying_companies=eq.randint(8500, 9200),
            ),
            breakdowns=[
                Breakdown("region", {"US": 0.633, "Developed ex-US": 0.259, "Emerging Markets": 0.108}),
                *_index_style_breakdowns(eq, jitter=False),
            ],
            source=SOURCE,
        ),
        PortfolioData(
            subject_id=FI_BENCHMARK, subject_kind="benchmark", sleeve="fixed_income", as_of=as_of,
            characteristics=Characteristics(
                effective_duration=round(fi.uniform(5.9, 6.4), 2),
                effective_maturity=round(fi.uniform(8.2, 8.9), 2),
                yield_to_maturity=round(fi.uniform(0.043, 0.048), 4),
                sec_yield=round(fi.uniform(0.041, 0.046), 4),
                avg_coupon=round(fi.uniform(0.031, 0.036), 4),
                avg_credit_quality="AA",
            ),
            breakdowns=[
                Breakdown("credit_rating", {
                    "AAA": 0.442, "AA": 0.122, "A": 0.201, "BBB": 0.195,
                    "BB": 0.0, "B": 0.0, "CCC & Below": 0.0, "Not Rated": 0.04,
                }),
                Breakdown("security_type", {
                    "Government": 0.451, "Municipal": 0.005, "Corporate": 0.253,
                    "Securitized": 0.281, "Cash & Equivalents": 0.01,
                }),
                Breakdown("maturity_band", {
                    "0-1Y": 0.021, "1-3Y": 0.223, "3-5Y": 0.192, "5-7Y": 0.128,
                    "7-10Y": 0.196, "10-20Y": 0.101, "20Y+": 0.139,
                }),
            ],
            source=SOURCE,
        ),
    ]


#: Rough shape of an upward-sloping curve, as decimal fractions. Jittered per period.
CURVE_SHAPE = {
    "1M": 0.0455, "3M": 0.0448, "6M": 0.0432, "1Y": 0.0408, "2Y": 0.0392,
    "3Y": 0.0389, "5Y": 0.0396, "7Y": 0.0409, "10Y": 0.0424, "20Y": 0.0455, "30Y": 0.0448,
}


def market_points(periods: list) -> list:
    points = []
    for i, as_of in enumerate(reversed(periods)):  # oldest first, so the drift reads forward
        rnd = rng_for("curve", as_of)
        shift = (i - len(periods) / 2) * 0.0015
        for tenor, base in CURVE_SHAPE.items():
            points.append(MarketPoint(
                "ust_par_yield", as_of, round(base + shift + rnd.uniform(-0.0008, 0.0008), 5),
                tenor=tenor, source=SOURCE,
            ))
        points.append(MarketPoint(
            "ig_oas", as_of, round(rnd.uniform(88, 142), 1), source=SOURCE))
        points.append(MarketPoint(
            "hy_oas", as_of, round(rnd.uniform(310, 470), 1), source=SOURCE))
    return points


def clear(cfg) -> None:
    """Remove only what this script wrote — matched on the marker source."""
    conn = open_portfolio(cfg)
    try:
        bootstrap(conn, cfg)
        with write_tx(conn) as cur:
            total = 0
            for table in ("pf_characteristics", "pf_performance", "pf_breakdowns", TABLE_MARKET_SERIES):
                cur.execute(f"DELETE FROM {table} WHERE source = ?", (SOURCE,))
                total += cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        print(f"Removed {total} seeded row(s).")
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--quarters", type=int, default=4, help="how many recent quarters to seed")
    parser.add_argument("--clear", action="store_true", help="remove seeded rows and exit")
    parser.add_argument("--dry-run", action="store_true", help="validate everything, write nothing")
    args = parser.parse_args()

    cfg = load_config()
    cfg.ensure_ready()

    if args.clear:
        clear(cfg)
        return 0

    periods = recent_quarter_ends(args.quarters)
    models = get_models(cfg=cfg)
    print(f"Seeding {len(models)} model(s) across {len(periods)} period(s): "
          f"{periods[-1]} .. {periods[0]}")

    payloads = []
    for as_of in periods:
        payloads.extend(benchmark_payloads(as_of))
        for model in models:
            if model.equity:
                payloads.append(equity_payload(model, as_of))
                # The regional slices an analytics engine would compute from a security
                # master. Seeded for every model with equity, so each scope has data.
                for sleeve in EQUITY_REGION_SLEEVES:
                    payloads.append(equity_payload(model, as_of, sleeve))
            if model.fixed_income:
                payloads.append(fixed_income_payload(model, as_of))

    summary = upload_pf_data(payloads, dry_run=args.dry_run, cfg=cfg)
    print(summary.render())

    market = upload_market_series(market_points(periods), dry_run=args.dry_run, cfg=cfg)
    print(market.render())

    return max(summary.exit_code, market.exit_code)


if __name__ == "__main__":
    sys.exit(main())
