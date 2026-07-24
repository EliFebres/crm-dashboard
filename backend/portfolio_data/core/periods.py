"""
Quarter-end arithmetic, and why every model-level `as_of` has to be one.

The Portfolio Trends page builds its period dropdown from `getRecentQuarterEnds`
(app/dashboard/interactions-and-trends/portfolio-trends/page.tsx), which emits labels for
*completed* quarters only — "Q1 2026", "Q4 2025", and so on. Those labels are the entire
set of periods a user can select.

So a row stamped `2026-02-14` is not merely unusual, it is unreachable: no dropdown entry
resolves to it, no query asks for it, and it sits in the table forever looking fine. That
is why `validation/rules.py` treats a non-quarter-end `as_of` as an ERROR rather than a
warning, and why the helpers to *produce* a correct one live here where callers can find
them.

Market series are exempt — see `upload_market_series`. A yield curve is naturally daily
and the credit-spread card plots a history, so those dates are not constrained.
"""

import calendar
import re
from datetime import date
from typing import List, Optional

__all__ = [
    "is_quarter_end",
    "parse_iso_date",
    "quarter_end",
    "quarter_end_for_label",
    "quarter_label",
    "recent_quarter_ends",
]

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: "Q1 2026" — the exact shape the page's period dropdown renders.
_LABEL = re.compile(r"^Q([1-4])\s+(\d{4})$")

#: The month each quarter ends in.
_QUARTER_END_MONTH = {1: 3, 2: 6, 3: 9, 4: 12}


def parse_iso_date(value: str) -> Optional[date]:
    """
    Parse a strict `YYYY-MM-DD` string, or return None.

    Deliberately strict: `date.fromisoformat` on 3.11+ accepts forms like `20260331` and
    full timestamps, which would let two spellings of the same day become two different
    primary keys. We want exactly one spelling.
    """
    if not isinstance(value, str) or not _ISO.match(value.strip()):
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        return None


def is_quarter_end(value: str) -> bool:
    """True when `value` is an ISO date falling on the last day of Mar/Jun/Sep/Dec."""
    parsed = parse_iso_date(value)
    if parsed is None or parsed.month not in (3, 6, 9, 12):
        return False
    return parsed.day == calendar.monthrange(parsed.year, parsed.month)[1]


def quarter_end(year: int, quarter: int) -> str:
    """ISO date of the last day of `quarter` (1-4) in `year`. Raises on a bad quarter."""
    if quarter not in _QUARTER_END_MONTH:
        raise ValueError(f"quarter must be 1-4, got {quarter!r}")
    month = _QUARTER_END_MONTH[quarter]
    return date(year, month, calendar.monthrange(year, month)[1]).isoformat()


def quarter_end_for_label(label: str) -> str:
    """
    Turn a dashboard period label into the ISO date to stamp on an upload.

        quarter_end_for_label("Q1 2026")  ->  "2026-03-31"

    This is the intended way to produce an `as_of`: it cannot produce a date the period
    dropdown will not offer.
    """
    match = _LABEL.match((label or "").strip())
    if not match:
        raise ValueError(
            f"Not a period label: {label!r}. Expected the shape the dashboard renders, "
            f"e.g. 'Q1 2026'."
        )
    return quarter_end(int(match.group(2)), int(match.group(1)))


def quarter_label(as_of: str) -> str:
    """
    Inverse of `quarter_end_for_label` — the label the dashboard would show for this date.
    Useful in log lines and error messages, where "Q1 2026" reads better than "2026-03-31".
    """
    parsed = parse_iso_date(as_of)
    if parsed is None:
        raise ValueError(f"Not an ISO date: {as_of!r}")
    return f"Q{(parsed.month - 1) // 3 + 1} {parsed.year}"


def recent_quarter_ends(count: int, *, today: Optional[date] = None) -> List[str]:
    """
    The `count` most recent *completed* quarter ends, newest first.

    A port of `getRecentQuarterEnds` in the page, so a backfill loop covers exactly the
    periods the dropdown offers and no others. `today` is injectable for the smoke test.
    """
    now = today or date.today()
    quarter = (now.month - 1) // 3 + 1
    year = now.year

    # Step back to the most recent *completed* quarter — the current one is in progress.
    quarter -= 1
    if quarter == 0:
        quarter, year = 4, year - 1

    out: List[str] = []
    for _ in range(max(0, count)):
        out.append(quarter_end(year, quarter))
        quarter -= 1
        if quarter == 0:
            quarter, year = 4, year - 1
    return out
