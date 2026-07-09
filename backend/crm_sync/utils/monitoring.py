"""
Structured logging and alerting.

An entire department reads the dashboard this package writes to. A job that fails loudly is
an inconvenience; a job that fails *quietly* means someone makes a decision on a week of
missing data. So every record is traced end to end, and anything that could make an
interaction wrong or invisible raises an alert.

Two outputs:

  * A JSON-lines log (`crm_sync.jsonl`), one object per line, rotated. Machine-greppable:
    every line carries `run_id` (this process) and `correlation_id` (this record), so
    `jq 'select(.correlation_id == "...")'` reconstructs the full story of one interaction.
    A human-readable mirror goes to stderr.
  * Alert sinks, fired for findings at or above `cfg.alert_on` severity and for every raised
    exception. Route them wherever your team actually looks — see `CallableAlertSink`.
"""

import json
import logging
import logging.handlers
import sys
import urllib.error
import urllib.request
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from ..config import CrmConfig
from ..core.models import Finding, Severity

LOGGER_NAME = "crm_sync"


# =====================================================================================
# Alerts
# =====================================================================================


@dataclass
class Alert:
    """Something a human should look at."""

    severity: Severity
    title: str
    detail: str
    run_id: str
    correlation_id: Optional[str] = None
    engagement_id: Optional[int] = None
    findings: List[Finding] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "severity": self.severity.value,
            "title": self.title,
            "detail": self.detail,
            "run_id": self.run_id,
            "correlation_id": self.correlation_id,
            "engagement_id": self.engagement_id,
            "findings": [f.to_dict() for f in self.findings],
        }

    def render(self) -> str:
        head = f"[{self.severity.value}] {self.title}"
        if self.engagement_id is not None:
            head += f" (engagement #{self.engagement_id})"
        lines = [head, f"  {self.detail}"]
        lines.extend(f"  - {f}" for f in self.findings)
        lines.append(f"  run={self.run_id} record={self.correlation_id}")
        return "\n".join(lines)


class AlertSink(ABC):
    """Somewhere alerts go. Sinks must never raise — a broken pager can't fail the job."""

    @abstractmethod
    def emit(self, alert: Alert) -> None: ...


class ConsoleAlertSink(AlertSink):
    """Writes a boxed alert to stderr. On by default."""

    def emit(self, alert: Alert) -> None:
        print("\n" + "!" * 66, file=sys.stderr)
        print(alert.render(), file=sys.stderr)
        print("!" * 66 + "\n", file=sys.stderr)


class FileAlertSink(AlertSink):
    """Appends rendered alerts to a plain text file, for a human to skim after a nightly run."""

    def __init__(self, path) -> None:
        self.path = path

    def emit(self, alert: Alert) -> None:
        try:
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(alert.render() + "\n\n")
        except OSError as exc:  # a full disk must not take the job down
            print(f"[crm_sync] FileAlertSink failed: {exc}", file=sys.stderr)


class WebhookAlertSink(AlertSink):
    """
    POSTs the alert as JSON to a URL (Slack incoming webhook, PagerDuty Events API, ...).

    This is the only place in the package that touches the network, and it is opt-in.
    """

    def __init__(self, url: str, timeout: float = 5.0) -> None:
        self.url = url
        self.timeout = timeout

    def emit(self, alert: Alert) -> None:
        payload = json.dumps(alert.to_dict()).encode("utf-8")
        req = urllib.request.Request(
            self.url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
        )
        try:
            urllib.request.urlopen(req, timeout=self.timeout).close()
        except (urllib.error.URLError, OSError) as exc:
            print(f"[crm_sync] WebhookAlertSink failed: {exc}", file=sys.stderr)


class CallableAlertSink(AlertSink):
    """
    Hands the `Alert` to your own function. The escape hatch: route to email, Teams, Sentry,
    a database, whatever your team already watches.
    """

    def __init__(self, fn: Callable[[Alert], None]) -> None:
        self.fn = fn

    def emit(self, alert: Alert) -> None:
        try:
            self.fn(alert)
        except Exception as exc:  # noqa: BLE001 - a user callback must not kill the run
            print(f"[crm_sync] CallableAlertSink raised: {exc}", file=sys.stderr)


class MultiAlertSink(AlertSink):
    """Fans one alert out to several sinks. One failing sink doesn't stop the others."""

    def __init__(self, sinks: Optional[List[AlertSink]] = None) -> None:
        self.sinks: List[AlertSink] = sinks or []

    def add(self, sink: AlertSink) -> None:
        self.sinks.append(sink)

    def emit(self, alert: Alert) -> None:
        for sink in self.sinks:
            sink.emit(alert)


# =====================================================================================
# Structured logging
# =====================================================================================


class JsonLinesFormatter(logging.Formatter):
    """Renders each record as one JSON object. Extra fields ride on `record.crm`."""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "msg": record.getMessage(),
        }
        payload.update(getattr(record, "crm", {}) or {})
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class HumanFormatter(logging.Formatter):
    """Terse one-liner for stderr."""

    def format(self, record: logging.LogRecord) -> str:
        crm = getattr(record, "crm", {}) or {}
        cid = crm.get("correlation_id")
        prefix = f"[{record.levelname:<5}]"
        suffix = f"  ({cid[:8]})" if cid else ""
        return f"{prefix} {record.getMessage()}{suffix}"


class Monitor:
    """
    The observability facade the writer and batch runner talk to.

    Owns the logger, the alert sinks, and the per-run counters. One `Monitor` per process.
    """

    def __init__(self, cfg: CrmConfig, sinks: Optional[List[AlertSink]] = None) -> None:
        self.cfg = cfg
        self.run_id = uuid.uuid4().hex[:12]
        self.sinks = MultiAlertSink(sinks if sinks is not None else [ConsoleAlertSink()])
        self.finding_counts: Dict[str, int] = {}
        self.logger = self._build_logger(cfg)
        self.info("run started", run_id=self.run_id, sqlite_dir=str(cfg.sqlite_dir), strict=cfg.strict)

    # -- setup ---------------------------------------------------------------------

    def _build_logger(self, cfg: CrmConfig) -> logging.Logger:
        logger = logging.getLogger(LOGGER_NAME)
        logger.setLevel(logging.DEBUG)
        # Idempotent: a second Monitor in the same process must not double every line.
        if logger.handlers:
            return logger
        logger.propagate = False

        stream = logging.StreamHandler(sys.stderr)
        stream.setLevel(logging.INFO)
        stream.setFormatter(HumanFormatter())
        logger.addHandler(stream)

        if cfg.log_dir is not None:
            fh = logging.handlers.RotatingFileHandler(
                cfg.log_dir / "crm_sync.jsonl", maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
            )
            fh.setLevel(logging.DEBUG)
            fh.setFormatter(JsonLinesFormatter())
            logger.addHandler(fh)
            self.sinks.add(FileAlertSink(cfg.log_dir / "alerts.log"))

        return logger

    def add_alert_sink(self, sink: AlertSink) -> None:
        self.sinks.add(sink)

    # -- logging -------------------------------------------------------------------

    def _log(self, level: int, msg: str, **fields: Any) -> None:
        fields.setdefault("run_id", self.run_id)
        self.logger.log(level, msg, extra={"crm": fields})

    def debug(self, msg: str, **fields: Any) -> None:
        self._log(logging.DEBUG, msg, **fields)

    def info(self, msg: str, **fields: Any) -> None:
        self._log(logging.INFO, msg, **fields)

    def warn(self, msg: str, **fields: Any) -> None:
        self._log(logging.WARNING, msg, **fields)

    def error(self, msg: str, **fields: Any) -> None:
        self._log(logging.ERROR, msg, **fields)

    # -- record lifecycle ----------------------------------------------------------

    def start_record(self, correlation_id: str, label: str) -> None:
        self.info("record started", correlation_id=correlation_id, record=label, event="start")

    def record_findings(self, correlation_id: str, findings: List[Finding], *, engagement_id: Optional[int] = None) -> None:
        """
        Log every finding at its own level, tally it, and alert on the ones that matter.

        Alerts are batched per record rather than per finding — one page saying "this record
        has three problems" beats three pages.
        """
        if not findings:
            return
        for f in findings:
            self.finding_counts[f.code] = self.finding_counts.get(f.code, 0) + 1
            level = {
                Severity.ERROR: logging.ERROR,
                Severity.WARN: logging.WARNING,
                Severity.INFO: logging.INFO,
            }[f.severity]
            self._log(
                level, f"{f.field}: {f.message}",
                correlation_id=correlation_id, code=f.code, severity=f.severity.value,
                engagement_id=engagement_id, event="finding",
            )

        alertable = [f for f in findings if f.severity in self.cfg.alert_on]
        if alertable:
            worst = Severity.ERROR if any(f.severity is Severity.ERROR for f in alertable) else alertable[0].severity
            self.alert(
                worst,
                title=f"{len(alertable)} finding(s) on a client interaction",
                detail="A record produced findings at or above the configured alert threshold.",
                correlation_id=correlation_id,
                engagement_id=engagement_id,
                findings=alertable,
            )

    def success(self, correlation_id: str, engagement_id: int, crn: str, *, verified: bool) -> None:
        self.info(
            "interaction created", correlation_id=correlation_id, engagement_id=engagement_id,
            crn=crn, verified=verified, event="created",
        )

    def deduped(self, correlation_id: str, engagement_id: int) -> None:
        self.info(
            "interaction already present, skipped", correlation_id=correlation_id,
            engagement_id=engagement_id, event="deduped",
        )

    def failure(self, correlation_id: str, exc: Exception, *, engagement_id: Optional[int] = None) -> None:
        """Log an exception and always alert — a failed record never passes silently."""
        self._log(
            logging.ERROR, f"record failed: {exc}", correlation_id=correlation_id,
            engagement_id=engagement_id, error_type=type(exc).__name__, event="failed",
        )
        self.alert(
            Severity.ERROR,
            title=f"Client interaction failed to sync ({type(exc).__name__})",
            detail=str(exc),
            correlation_id=correlation_id,
            engagement_id=engagement_id,
            findings=getattr(exc, "findings", []) or [],
        )

    def alert(
        self,
        severity: Severity,
        *,
        title: str,
        detail: str,
        correlation_id: Optional[str] = None,
        engagement_id: Optional[int] = None,
        findings: Optional[List[Finding]] = None,
    ) -> None:
        self.sinks.emit(
            Alert(
                severity=severity, title=title, detail=detail, run_id=self.run_id,
                correlation_id=correlation_id, engagement_id=engagement_id,
                findings=findings or [],
            )
        )
