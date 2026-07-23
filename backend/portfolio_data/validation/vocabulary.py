"""
The controlled vocabularies: what a sleeve, a breakdown bucket, and a market series may be.

Two kinds of value live here, and they are not the same kind of thing:

**Mirrors of the TypeScript side.** `ASSET_CLASSES` and `CONSTITUENT_TYPES` are hand-kept
copies of app/lib/utils/portfolioHoldings.ts. If someone adds an asset class over there,
add it here too — otherwise `core/sleeves.py` silently drops every holding carrying it,
because normalization rejects anything outside the list. (That rejection is deliberate:
the alternative is a typo'd asset class quietly diluting a sleeve's weights.)

**Vocabularies this package owns.** The breakdown dimensions, their buckets, and the market
series are defined here and nowhere else. They exist because the dashboard cards name the
buckets they expect — an unrecognized bucket does not error anywhere, it just renders as an
unlabeled slice that no legend explains. Each entry below is traceable to a card.

This is the file to edit when a new breakdown or series is needed.
"""

from typing import Dict, Tuple

__all__ = [
    "ASSET_CLASSES",
    "CONSTITUENT_TYPES",
    "EQUITY_ASSET_CLASS",
    "FIXED_INCOME_ASSET_CLASS",
    "SLEEVES",
    "SLEEVE_TOTAL",
    "SLEEVE_EQUITY",
    "SLEEVE_EQUITY_US",
    "SLEEVE_EQUITY_DEVELOPED",
    "SLEEVE_EQUITY_EM",
    "SLEEVE_FIXED_INCOME",
    "EQUITY_SLEEVES",
    "EQUITY_REGION_SLEEVES",
    "SUBJECT_KINDS",
    "SUBJECT_MODEL",
    "SUBJECT_BENCHMARK",
    "BREAKDOWN_DIMENSIONS",
    "EQUITY_DIMENSIONS",
    "FIXED_INCOME_DIMENSIONS",
    "MARKET_SERIES",
    "SLEEVE_BENCHMARK",
    "BENCHMARK_NAMES",
    "SEED_BENCHMARKS",
]

# ---------------------------------------------------------------------------------
# Mirrored from app/lib/utils/portfolioHoldings.ts. Keep in sync by hand.
# ---------------------------------------------------------------------------------

#: Mirror of ASSET_CLASSES. A holding whose asset class is not in this tuple is dropped
#: during normalization, exactly as the TypeScript normalizeHoldingWeights drops it.
ASSET_CLASSES: Tuple[str, ...] = (
    "Equity",
    "Fixed Income",
    "Alternatives",
    "Crypto",
    "Fund of Funds",
    "Multi-Asset",
    "Cash",
)

#: Mirror of CONSTITUENT_TYPES.
CONSTITUENT_TYPES: Tuple[str, ...] = ("Portfolio", "Morningstar-Fund", "Security", "Index")

#: The two asset classes that define a sleeve. Everything else in ASSET_CLASSES appears
#: only in the total portfolio — see core/sleeves.py for why they cannot be split.
EQUITY_ASSET_CLASS = "Equity"
FIXED_INCOME_ASSET_CLASS = "Fixed Income"


# ---------------------------------------------------------------------------------
# Sleeves and subjects.
# ---------------------------------------------------------------------------------

SLEEVE_TOTAL = "total"
SLEEVE_EQUITY = "equity"
SLEEVE_FIXED_INCOME = "fixed_income"

# Regional slices of the equity book, matching the dashboard's equity scope selector.
SLEEVE_EQUITY_US = "equity_us"
SLEEVE_EQUITY_DEVELOPED = "equity_developed"
SLEEVE_EQUITY_EM = "equity_em"

#: Sleeves that are a regional slice of `equity` rather than an asset-class split.
#:
#: **These are upload-only.** `get_models()` cannot produce them: a holding record carries
#: an identifier, a constituent type, an asset class and a weight — and no domicile. Region
#: needs a security master keyed by identifier, which is precisely what this package does
#: not have and what the analytics engine on the other end does. So the engine splits the
#: equity sleeve by region itself and uploads each slice under one of these names.
#:
#: They behave like `equity` everywhere else: same metrics, same breakdown dimensions, same
#: validation. Only the benchmark differs — a US sleeve is measured against the Russell
#: 3000, not against an all-country index.
EQUITY_REGION_SLEEVES: Tuple[str, ...] = (
    SLEEVE_EQUITY_US, SLEEVE_EQUITY_DEVELOPED, SLEEVE_EQUITY_EM,
)

#: Every sleeve that describes an equity portfolio — the whole book, or one region of it.
EQUITY_SLEEVES: Tuple[str, ...] = (SLEEVE_EQUITY,) + EQUITY_REGION_SLEEVES

#: The only values `pf_*.sleeve` may hold. The dashboard filters on these exact strings,
#: so a typo'd sleeve is not a data error — it is an invisible row.
SLEEVES: Tuple[str, ...] = (SLEEVE_TOTAL, SLEEVE_FIXED_INCOME) + EQUITY_SLEEVES

SUBJECT_MODEL = "model"
SUBJECT_BENCHMARK = "benchmark"

SUBJECT_KINDS: Tuple[str, ...] = (SUBJECT_MODEL, SUBJECT_BENCHMARK)


# ---------------------------------------------------------------------------------
# Breakdown dimensions. Each maps to a card on the Portfolio Trends page; the buckets are
# what that card's legend can label.
# ---------------------------------------------------------------------------------

#: Every dimension a card actually draws. Bucket order is the axis order, so it is part of
#: the contract, not a formatting detail — app/lib/db/portfolioTrends.ts mirrors this
#: exactly and `validation/mirrors.py` fails the smoke test when the two drift.
#:
#: Two dimensions were removed here after the Style × Profitability card was rebuilt as a
#: style box plus a five-row table: `style_box` (a 9-cell grid that was declared in both
#: languages and never once written or read) and `profitability` (which the old three-mini-
#: chart card drew and nothing has read since). A dimension nothing renders is worse than
#: absent — it invites an upload that reports success and then shows up nowhere.
#: `Characteristics.profitability` is a different thing entirely and is still displayed.
BREAKDOWN_DIMENSIONS: Dict[str, Tuple[str, ...]] = {
    # "vs MSCI ACWI IMI" — regional equity positioning.
    "region": ("US", "Developed ex-US", "Emerging Markets"),
    # The style box's two axes: size (vertical) and value/growth (horizontal), plus the
    # allocation table beside it.
    "market_cap": ("Large", "Mid", "Small"),
    "style": ("Value", "Blend", "Growth"),
    # "Credit Breakdown" — ratings collapsed to the buckets the chart draws.
    "credit_rating": ("AAA", "AA", "A", "BBB", "BB", "B", "CCC & Below", "Not Rated"),
    # "Security Type" — instrument type per holding.
    "security_type": (
        "Government", "Municipal", "Corporate", "Securitized", "Cash & Equivalents",
    ),
    # "Maturity Breakdown" — maturity date per holding, bucketed.
    "maturity_band": ("0-1Y", "1-3Y", "3-5Y", "5-7Y", "7-10Y", "10-20Y", "20Y+"),
}

#: Dimensions that only make sense on an equity sleeve. Uploading one against
#: `fixed_income` is almost always a column-mapping mistake in the export, so it warns.
EQUITY_DIMENSIONS: Tuple[str, ...] = ("region", "market_cap", "style")

#: Dimensions that only make sense on a fixed-income sleeve. Same warning, other way.
FIXED_INCOME_DIMENSIONS: Tuple[str, ...] = (
    "credit_rating", "security_type", "maturity_band",
)


# ---------------------------------------------------------------------------------
# Market-level series. Not per-model, so these travel through get_market_series /
# upload_market_series rather than through a portfolio payload.
# ---------------------------------------------------------------------------------

#: series id -> (valid tenors, unit, plausible value range).
#:
#: The empty-string tenor means "this series has no term structure". It is '' rather than
#: NULL on purpose: SQLite permits NULLs in PRIMARY KEY columns, so a NULL tenor would
#: silently defeat the uniqueness constraint and let duplicate points pile up.
MARKET_SERIES: Dict[str, Dict[str, object]] = {
    # "Yield Curve" card — Treasury par yields by tenor, as decimal fractions (0.0425).
    "ust_par_yield": {
        "tenors": ("1M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"),
        "unit": "decimal_fraction",
        "plausible": (-0.05, 0.25),
    },
    # "Credit Spread" card — option-adjusted spreads in basis points.
    "ig_oas": {"tenors": ("",), "unit": "basis_points", "plausible": (0.0, 1500.0)},
    "hy_oas": {"tenors": ("",), "unit": "basis_points", "plausible": (0.0, 3000.0)},
}


# ---------------------------------------------------------------------------------
# Benchmarks the page already captions against. Seeded by db/schema.py so an upload can
# reference them on a fresh database without a registration step.
# ---------------------------------------------------------------------------------

#: sleeve -> the benchmark id it is measured against.
#:
#: One index per sleeve, because a regional slice needs a regional benchmark: comparing a
#: US-only book to an all-country index would report a US overweight that is an artifact of
#: the scope, not a decision anyone made.
#:
#: `total` has no index of its own — a blended book has nothing to compare against as a
#: whole — so it points at the all-country equity index, matching what the dashboard does.
#: This is the authoritative mapping; app/lib/db/portfolioTrends.ts mirrors it and
#: `validation/mirrors.py` fails the smoke test if the two disagree.
SLEEVE_BENCHMARK: Dict[str, str] = {
    SLEEVE_TOTAL: "MSCI-ACWI-IMI",
    SLEEVE_EQUITY: "MSCI-ACWI-IMI",
    SLEEVE_EQUITY_US: "RUSSELL-3000",
    SLEEVE_EQUITY_DEVELOPED: "MSCI-WORLD-EX-USA-IMI",
    SLEEVE_EQUITY_EM: "MSCI-EM-IMI",
    SLEEVE_FIXED_INCOME: "BBG-US-AGG",
}

#: Display name per benchmark id.
BENCHMARK_NAMES: Dict[str, str] = {
    "MSCI-ACWI-IMI": "MSCI ACWI IMI",
    "RUSSELL-3000": "Russell 3000 Index",
    "MSCI-WORLD-EX-USA-IMI": "MSCI World ex USA IMI Index",
    "MSCI-EM-IMI": "MSCI Emerging Markets IMI Index",
    "BBG-US-AGG": "Bloomberg US Aggregate",
}

#: (id, display name, the sleeve it benchmarks, is_default) — what db/schema.py seeds into
#: `pf_benchmarks`. Derived from the two maps above rather than restating them, so a new
#: index is added in one place. `total` is skipped: it shares the equity index rather than
#: registering a second row for it.
SEED_BENCHMARKS: Tuple[Tuple[str, str, str, bool], ...] = tuple(
    (SLEEVE_BENCHMARK[sleeve], BENCHMARK_NAMES[SLEEVE_BENCHMARK[sleeve]], sleeve, True)
    for sleeve in (
        SLEEVE_EQUITY, SLEEVE_EQUITY_US, SLEEVE_EQUITY_DEVELOPED,
        SLEEVE_EQUITY_EM, SLEEVE_FIXED_INCOME,
    )
)
