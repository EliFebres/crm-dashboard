"""
Splitting a logged model into the three portfolios an analytics run actually needs.

A client model is stored as one flat list of holdings whose weights sum to 1. That is the
right shape for the Portfolio modal and wrong for almost every analytic: running an equity
style analysis over a portfolio that is 38% bonds produces a market cap and a price-to-book
that describe nothing real, and a duration computed over the whole thing is diluted by
every share of stock in it.

So each model comes out as three sleeves:

    total          every holding, weights as logged (sum 1.0)
    equity         Equity holdings only, rescaled to sum 1.0
    fixed_income   Fixed Income holdings only, rescaled to sum 1.0

**Sleeve membership is strict.** Equity means `assetClass == 'Equity'`; fixed income means
`'Fixed Income'`. Alternatives, Crypto, Fund of Funds, Multi-Asset and Cash appear only in
`total`. They are not omissions — a Multi-Asset fund genuinely contains both stocks and
bonds, and splitting it needs look-through holdings data this store does not have. Guessing
a split would put invented numbers into both sleeves.

The consequence is worth stating plainly, because it surprises people:
`equity.weight_of_total + fixed_income.weight_of_total` is usually **less than 1**. That
residual is exactly the un-decomposable part, and `weight_of_total` is how you weight a
sleeve-level statistic back up to portfolio level.

Normalization itself is a port of `normalizeHoldingWeights`
(app/lib/utils/portfolioHoldings.ts), applied twice: once to the raw list, then again to
each extracted sleeve. Keeping the two implementations identical matters — the TypeScript
side normalizes on write, so a mismatch here would make the same model produce different
weights depending on which language read it.
"""

import json
from typing import Any, Iterable, List, Sequence, Tuple

from ..validation.vocabulary import (
    ASSET_CLASSES,
    CONSTITUENT_TYPES,
    EQUITY_ASSET_CLASS,
    FIXED_INCOME_ASSET_CLASS,
    SLEEVE_EQUITY,
    SLEEVE_FIXED_INCOME,
    SLEEVE_TOTAL,
)
from .models import Holding, Sleeve

__all__ = ["parse_holdings", "normalize", "build_sleeves", "extract_sleeve"]


def parse_holdings(raw: Any) -> List[dict]:
    """
    Safe-parse the `client_models.holdings` JSON column.

    Mirrors `parseHoldings` in app/lib/db/clientModels.ts: anything that is not a JSON
    array becomes an empty list rather than an exception. A model with a corrupt blob
    should read as "no holdings", not take down a pull over every other model.
    """
    if not isinstance(raw, str) or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
    except (ValueError, TypeError):
        return []
    if not isinstance(parsed, list):
        return []
    return [h for h in parsed if isinstance(h, dict)]


def _valid(identifier: Any, constituent_type: Any, asset_class: Any, weight: Any) -> bool:
    """The filter half of normalizeHoldingWeights, field for field."""
    if not isinstance(identifier, str) or not identifier.strip():
        return False
    if asset_class not in ASSET_CLASSES or constituent_type not in CONSTITUENT_TYPES:
        return False
    if not isinstance(weight, (int, float)) or isinstance(weight, bool):
        return False
    # Rejects NaN and inf as well as <= 0: `nan > 0` is False, which is the behaviour we
    # want, and Number.isFinite on the TypeScript side rejects them for the same reason.
    return weight > 0 and weight == weight and weight not in (float("inf"), float("-inf"))


def normalize(holdings: Iterable[Any]) -> Tuple[Holding, ...]:
    """
    Drop incomplete entries and rescale the survivors to sum to 1.0.

    Accepts dicts (as parsed from the JSON column, camelCase keys) or `Holding` objects,
    so it can be applied to a raw list and then re-applied to an extracted sleeve.
    Returns an empty tuple when nothing survives — never raises.
    """
    cleaned: List[Tuple[str, str, str, float]] = []
    for h in holdings or ():
        if isinstance(h, Holding):
            identifier, ctype, aclass, weight = h.identifier, h.constituent_type, h.asset_class, h.weight
        elif isinstance(h, dict):
            identifier = h.get("identifier")
            ctype = h.get("constituentType", h.get("constituent_type"))
            aclass = h.get("assetClass", h.get("asset_class"))
            weight = h.get("weight")
        else:
            continue

        if _valid(identifier, ctype, aclass, weight):
            cleaned.append((identifier.strip().upper(), ctype, aclass, float(weight)))

    total = sum(c[3] for c in cleaned)
    if not cleaned or total <= 0:
        return ()

    return tuple(
        Holding(identifier=i, constituent_type=c, asset_class=a, weight=w / total)
        for i, c, a, w in cleaned
    )


def extract_sleeve(total: Sequence[Holding], asset_class: str, name: str) -> Sleeve:
    """
    Pull one asset class out of an already-normalized total and rescale it to stand alone.

    `weight_of_total` is captured *before* rescaling — it is the share of the portfolio
    this sleeve represents, and it is the only thing rescaling destroys.

    An empty result is a legitimate answer, not an error: plenty of models are 100% equity
    and have no fixed income at all. Callers get an empty `Sleeve` (falsy, len 0), never
    None, so `for h in model.fixed_income.holdings` is always safe.
    """
    members = [h for h in total if h.asset_class == asset_class]
    weight_of_total = sum(h.weight for h in members)
    if not members or weight_of_total <= 0:
        return Sleeve(name=name, holdings=(), weight_of_total=0.0)
    return Sleeve(name=name, holdings=normalize(members), weight_of_total=weight_of_total)


def build_sleeves(raw_holdings: Any) -> Tuple[Sleeve, Sleeve, Sleeve]:
    """
    Turn a model's stored holdings into (total, equity, fixed_income).

    `raw_holdings` may be the raw JSON string from the column, a parsed list of dicts, or
    a list of `Holding`s.
    """
    if isinstance(raw_holdings, str):
        raw_holdings = parse_holdings(raw_holdings)

    total_holdings = normalize(raw_holdings or ())
    total = Sleeve(
        name=SLEEVE_TOTAL,
        holdings=total_holdings,
        # A non-empty total is always the whole portfolio by definition. An empty one
        # represents nothing, so 0.0 rather than a misleading 1.0.
        weight_of_total=1.0 if total_holdings else 0.0,
    )
    equity = extract_sleeve(total_holdings, EQUITY_ASSET_CLASS, SLEEVE_EQUITY)
    fixed_income = extract_sleeve(total_holdings, FIXED_INCOME_ASSET_CLASS, SLEEVE_FIXED_INCOME)
    return total, equity, fixed_income
