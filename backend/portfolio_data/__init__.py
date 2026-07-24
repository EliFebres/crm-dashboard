"""
portfolio_data — pull logged client models, push their characteristics and performance.

Two halves of one round trip.

**Pull.** `get_models()` returns every logged model split into the three portfolios an
analytics run needs — the total, the equity sleeve rescaled to 100%, and the fixed income
sleeve rescaled to 100%:

    from portfolio_data import get_models

    for model in get_models():
        analyse_equity(model.equity.identifiers)          # style, market cap, region
        analyse_bonds(model.fixed_income.identifiers)     # duration, credit, maturity

The split is the point. An equity style analysis run over a portfolio that is 38% bonds
produces a price-to-book that describes nothing, and a duration computed over the whole
thing is diluted by every share of stock in it.

**Push.** `upload_pf_data()` sends the results back:

    from portfolio_data import (PortfolioData, Characteristics, Performance, Breakdown,
                                upload_pf_data, quarter_end_for_label)

    summary = upload_pf_data(PortfolioData(
        subject_id=model.id,
        sleeve="equity",
        as_of=quarter_end_for_label("Q1 2026"),
        characteristics=Characteristics(price_to_book=2.87, profitability=0.31),
        performance=Performance(return_1y=0.084, benchmark_id="MSCI-ACWI-IMI"),
        breakdowns=[Breakdown("region", {"US": 0.62, "Developed ex-US": 0.28,
                                         "Emerging Markets": 0.10})],
        source="Morningstar Direct 2026-04-02",
    ))
    raise SystemExit(summary.exit_code)

Benchmarks go through the same call with `subject_kind="benchmark"`, because every card on
the Portfolio Trends page is captioned "vs <index>" and the comparison has to be one query.
Market-level series — Treasury par yields, credit spreads — belong to nobody's portfolio,
so they get their own pair: `get_market_series()` / `upload_market_series()`.

Models are read from `client_models` in engagements.sqlite, which is the source of truth
and never stale. Uploads land in `portfolio.sqlite` beside `portfolio_models`, which is
where the dashboard reads. Both files are found through `SQLITE_DIR`, resolved by crm_sync
from the environment or the same `.env` the Next.js app uses — in a checkout there is
nothing to set up.

Everything is stored as decimal fractions: 8.4% is `0.084`. Validation rejects `8.4`,
because 840% and 8.4% look equally plausible once they are sitting in a database.

Internals live under `core/`, `db/` and `validation/`. They are importable, but the
supported surface is the four functions above.
"""

from .core.config import PortfolioConfig, load_config
from .core.exceptions import (
    ConfigError,
    PortfolioDataError,
    PortfolioValidationError,
    PortfolioVisibilityError,
    UnknownSubjectError,
)
from .core.models import (
    EXIT_OK,
    EXIT_PARTIAL_FAILURE,
    EXIT_STARTUP_FAILURE,
    EXIT_TOTAL_FAILURE,
    Breakdown,
    Characteristics,
    Finding,
    Holding,
    LoggedModel,
    MarketPoint,
    Performance,
    PortfolioData,
    Severity,
    Sleeve,
    UploadSummary,
)
from .core.periods import (
    is_quarter_end,
    quarter_end,
    quarter_end_for_label,
    quarter_label,
    recent_quarter_ends,
)
from .pull import get_market_series, get_models, to_rows
from .push import prune_orphans, upload_market_series, upload_pf_data
from .validation.vocabulary import (
    ASSET_CLASSES,
    BREAKDOWN_DIMENSIONS,
    MARKET_SERIES,
    SLEEVES,
)

__version__ = "1.0.0"

__all__ = [
    # the entry points
    "get_models",
    "upload_pf_data",
    "get_market_series",
    "upload_market_series",
    # helpers around them
    "to_rows",
    "prune_orphans",
    "quarter_end_for_label",
    "quarter_end",
    "quarter_label",
    "recent_quarter_ends",
    "is_quarter_end",
    # what get_models returns
    "LoggedModel",
    "Sleeve",
    "Holding",
    # what upload_pf_data accepts
    "PortfolioData",
    "Characteristics",
    "Performance",
    "Breakdown",
    "MarketPoint",
    # results
    "UploadSummary",
    "Finding",
    "Severity",
    "EXIT_OK",
    "EXIT_PARTIAL_FAILURE",
    "EXIT_STARTUP_FAILURE",
    "EXIT_TOTAL_FAILURE",
    # configuration
    "PortfolioConfig",
    "load_config",
    "SLEEVES",
    "ASSET_CLASSES",
    "BREAKDOWN_DIMENSIONS",
    "MARKET_SERIES",
    # exceptions
    "PortfolioDataError",
    "PortfolioValidationError",
    "UnknownSubjectError",
    "PortfolioVisibilityError",
    "ConfigError",
]
