"""
Exception hierarchy for portfolio_data.

Everything here descends from `crm_sync`'s `CrmSyncError`, so a scheduler that already
wraps a sync job in `except CrmSyncError` catches these too without knowing this package
exists. The base class carries the `findings` that explain a failure, so an alert sink or
a log line has full context without the caller stitching anything back together.

Catch `PortfolioDataError` to handle "this record failed" generically — that is what the
upload loop does, so one bad payload never aborts a run. Anything that is *not* one of
these (a `KeyError` in your fetch code, say) is a bug and is allowed to escape.
"""

from crm_sync.core.exceptions import ConfigError, CrmSyncError

__all__ = [
    "ConfigError",
    "CrmSyncError",
    "PortfolioDataError",
    "PortfolioValidationError",
    "UnknownSubjectError",
    "PortfolioVisibilityError",
]


class PortfolioDataError(CrmSyncError):
    """Base class. Every failure this package raises on purpose is one of these."""


class PortfolioValidationError(PortfolioDataError):
    """
    Strict-mode validation produced ERROR findings. Raised *before* any transaction is
    opened, so nothing was written and nothing needs undoing.
    """


class UnknownSubjectError(PortfolioValidationError):
    """
    The payload names a `subject_id` that is neither a live `client_models` row nor a
    registered benchmark.

    Worth its own type because it is the one validation failure with an obvious fix that
    is not "correct the number": either the model was deleted upstream after you pulled
    it, or the benchmark needs registering in `pf_benchmarks` first.
    """


class PortfolioVisibilityError(PortfolioDataError):
    """
    Post-write verification re-read the row and found something that keeps it off the
    dashboard. The write already committed — this is a shout, not a prevention.
    """
