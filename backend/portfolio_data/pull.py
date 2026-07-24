"""
Everything you can pull out of the CRM: logged models, and stored market series.

    from portfolio_data import get_models

    for model in get_models():
        print(model.client_name, model.model_name)
        print("  total :", len(model.total), "positions")
        print("  equity:", model.equity.identifiers, f"({model.equity.weight_of_total:.0%})")
        print("  bonds :", model.fixed_income.identifiers)

Each model comes back as three portfolios: the whole thing, the equity sleeve rescaled to
100%, and the fixed income sleeve rescaled to 100%. Feed the equity sleeve to an equity
style/profitability run and the fixed income sleeve to a duration/credit run — running
either against the blended portfolio produces numbers that describe nothing real.

The counterpart is `upload_pf_data` in push.py: pass `model.id` straight back as
`subject_id` and the round trip closes.
"""

import logging
from typing import Any, Dict, Iterable, List, Optional, Sequence

from .core.config import PortfolioConfig, resolve
from .core.models import LoggedModel, MarketPoint
from .db.reader import read_market_series, read_models
from .validation.vocabulary import SLEEVES

__all__ = ["get_models", "get_market_series", "to_rows"]

_log = logging.getLogger("portfolio_data")


def get_models(
    *,
    crn: Optional[str] = None,
    model_ids: Optional[Iterable[str]] = None,
    departments: Optional[Iterable[str]] = None,
    offices: Optional[Iterable[str]] = None,
    teams: Optional[Iterable[str]] = None,
    min_aum: Optional[int] = None,
    main_only: bool = False,
    logged_since: Optional[str] = None,
    cfg: Optional[PortfolioConfig] = None,
) -> List[LoggedModel]:
    """
    Pull logged client models, each split into total / equity / fixed income sleeves.

    Filters AND together; passing none returns every logged model.

    Args:
        crn: One external client, by CRN.
        model_ids: Specific `client_models.id` values — e.g. re-pulling a batch.
        departments: The client department recorded on the logging interaction.
        offices: The office that logged the model.
        teams: The team that logged it.
        min_aum: Strict lower bound in dollars. Matches the dashboard's "over $1B"
            semantics, including the part people forget: a model whose AUM was never
            entered satisfies *no* threshold, because SQL excludes NULL from a comparison.
            Those exclusions are logged rather than left to read as "nothing matched".
        main_only: Only each client's main model — the `Avg. Client` cohort.
        logged_since: ISO date; models last logged on or after it.
        cfg: Reuse a resolved config across many calls. None reads the environment.

    Returns:
        Models in CRN then sort order. Sleeves are always present: a model with no bonds
        gets an empty `fixed_income` sleeve, never None.
    """
    resolved = resolve(cfg)
    models = read_models(
        resolved,
        crn=crn,
        model_ids=model_ids,
        departments=departments,
        offices=offices,
        teams=teams,
        min_aum=min_aum,
        main_only=main_only,
        logged_since=logged_since,
    )

    if min_aum is not None:
        # The exclusion happened inside SQL and is invisible in the result. Say so.
        without_aum = read_models(resolved, crn=crn, model_ids=model_ids)
        dropped = sum(1 for m in without_aum if m.aum is None)
        if dropped:
            _log.warning(
                "%d model(s) have no AUM recorded and match no min_aum threshold.", dropped
            )

    empty = [m for m in models if not m.total]
    if empty:
        _log.info(
            "%d of %d model(s) have no usable holdings (blank, or every row incomplete).",
            len(empty), len(models),
        )
    return models


def to_rows(
    models: Sequence[LoggedModel], *, sleeves: Optional[Iterable[str]] = None
) -> List[Dict[str, Any]]:
    """
    Flatten models into one row per (model, sleeve, holding).

    This is the shape an analytics upload actually wants — a CSV, a DataFrame, or a request
    body — and every caller would otherwise write the same nested loop. Sleeves with no
    holdings contribute no rows.

        rows = to_rows(get_models(), sleeves=["equity"])
        # {'model_id': ..., 'sleeve': 'equity', 'identifier': 'VTI',
        #  'constituent_type': 'Security', 'asset_class': 'Equity',
        #  'weight': 0.42, 'weight_of_total': 0.6, ...}

    `weight` is within the sleeve; `weight_of_total` is the sleeve's share of the whole
    portfolio, so `weight * weight_of_total` is the position's true portfolio weight.
    """
    wanted = list(sleeves) if sleeves is not None else list(SLEEVES)
    unknown = [s for s in wanted if s not in SLEEVES]
    if unknown:
        raise ValueError(f"Unknown sleeve(s): {', '.join(unknown)}. Valid: {', '.join(SLEEVES)}")

    rows: List[Dict[str, Any]] = []
    for model in models:
        for name in wanted:
            sleeve = model.sleeve(name)
            for holding in sleeve.holdings:
                rows.append({
                    "model_id": model.id,
                    "crn": model.crn,
                    "client_name": model.client_name,
                    "model_name": model.model_name,
                    "is_main": model.is_main,
                    "aum": model.aum,
                    "sleeve": name,
                    "weight_of_total": sleeve.weight_of_total,
                    "identifier": holding.identifier,
                    "constituent_type": holding.constituent_type,
                    "asset_class": holding.asset_class,
                    "weight": holding.weight,
                })
    return rows


def get_market_series(
    *,
    series: Optional[Iterable[str]] = None,
    tenors: Optional[Iterable[str]] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    cfg: Optional[PortfolioConfig] = None,
) -> List[MarketPoint]:
    """
    Read back stored market-level observations — Treasury par yields, credit spreads.

    Separate from `get_models` because these are not per-model and not per-sleeve: a
    yield curve belongs to the market, not to anybody's portfolio.

    The usual reason to call this is to find the gap before an upload — "what is the latest
    date I already have?" — so a backfill job fetches only what is missing:

        have = {p.as_of for p in get_market_series(series=["ig_oas"])}

    Args:
        series: Series ids to include. None means every series.
        tenors: Tenors to include. '' selects a series with no term structure.
        start / end: Inclusive ISO date bounds.

    Returns:
        Points ordered by series, then date, then tenor.
    """
    resolved = resolve(cfg)
    return read_market_series(resolved, series=series, tenors=tenors, start=start, end=end)
