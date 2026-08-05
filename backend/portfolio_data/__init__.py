"""
portfolio_data — pull logged client models, push their characteristics and performance.

Two halves of one round trip, and the way through both is a DataFrame.

**Pull a table, fill in the blanks, hand it back.**

    from portfolio_data import models_frame, blank_frame, upload_frame

    models = models_frame(min_aum=1_000_000_000)          # who is there
    df = blank_frame(models, sleeves=["equity"], as_of="Q1 2026")
    df.loc[df.sleeve == "equity", "price_to_book"] = 2.87  # fill in what you measured
    print(upload_frame(df, source="Morningstar Direct", dry_run=True).render())

One row per (subject, sleeve, quarter); one column per thing you could measure; every
metric blank until you fill it. **Blank means "not measured", which means "leave whatever
is already stored alone"** — so returns can land in a different pass from characteristics
without either wiping the other, and there is nothing to remember about partial uploads.
An unrecognized column is rejected rather than dropped, because a misspelled
`price_to_books` would otherwise produce an upload that reports success and stores nothing.

`backend/notebooks/portfolio_data.ipynb` is this walkthrough with the cells already
written. `holdings_frame()` gives you the positions themselves, `stored_frame()` reads back
what has been uploaded in the same shape, and `market_frame()` / `market_template()` do
the market-level series — Treasury par yields and credit spreads, which belong to the
market rather than to anybody's portfolio.

**Why the sleeves.** Every model comes back split into three portfolios: the total, the
equity sleeve rescaled to 100%, and the fixed income sleeve rescaled to 100%. An equity
style analysis run over a portfolio that is 38% bonds produces a price-to-book that
describes nothing, and a duration computed over the whole thing is diluted by every share
of stock in it.

**Advanced: the dataclass API.** Everything above is a thin layer over these, which remain
fully supported and are what you want inside a scheduled job, where a frame buys nothing:

    from portfolio_data import (PortfolioData, Characteristics, Performance, Breakdown,
                                get_models, upload_pf_data, quarter_end_for_label)

    for model in get_models():
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

Benchmarks go through the same path with `subject_kind="benchmark"`, because every card on
the Portfolio Trends page is captioned "vs <index>" and the comparison has to be one query.

Models are read from `client_models` in engagements.sqlite, which is the source of truth
and never stale. Uploads land in `portfolio.sqlite` beside `portfolio_models`, which is
where the dashboard reads. Both files are found through `SQLITE_DIR`, resolved by crm_sync
from the environment or the same `.env` the Next.js app uses — in a checkout there is
nothing to set up.

Everything is stored as decimal fractions: 8.4% is `0.084`. Validation rejects `8.4`,
because 840% and 8.4% look equally plausible once they are sitting in a database.

Internals live under `core/`, `db/` and `validation/`. They are importable, but the
supported surface is what `__all__` names below.
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
from .frames import (
    BREAKDOWN_COLUMNS,
    CHARACTERISTIC_COLUMNS,
    CONTEXT_COLUMNS,
    KEY_COLUMNS,
    NAMES_COLUMNS,
    PERFORMANCE_COLUMNS,
    blank_frame,
    fill,
    findings_frame,
    holdings_frame,
    market_frame,
    market_template,
    models_frame,
    stored_frame,
    template_columns,
    upload_frame,
    upload_market_frame,
)
from .pull import PULLABLE_SLEEVES, get_market_series, get_models, to_rows
from .push import prune_orphans, upload_market_series, upload_pf_data
from .validation.vocabulary import (
    ASSET_CLASSES,
    BREAKDOWN_DIMENSIONS,
    MARKET_SERIES,
    SLEEVES,
)

__version__ = "1.1.0"

__all__ = [
    # the DataFrame front door
    "models_frame",
    "holdings_frame",
    "blank_frame",
    "fill",
    "upload_frame",
    "stored_frame",
    "market_frame",
    "market_template",
    "upload_market_frame",
    "findings_frame",
    "template_columns",
    "KEY_COLUMNS",
    "CONTEXT_COLUMNS",
    "CHARACTERISTIC_COLUMNS",
    "PERFORMANCE_COLUMNS",
    "BREAKDOWN_COLUMNS",
    "NAMES_COLUMNS",
    # the dataclass entry points underneath
    "get_models",
    "upload_pf_data",
    "get_market_series",
    "upload_market_series",
    # helpers around them
    "to_rows",
    "PULLABLE_SLEEVES",
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
