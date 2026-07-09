"""
Post-write SSE nudge.

The dashboard live-updates through Server-Sent Events. The stream is fed by
`emitEngagementChange()`, an in-process Node EventEmitter (app/lib/events/index.ts) — which
only code running inside the Next.js server can call. This package writes straight to SQLite
from a separate process, so it physically cannot fire that event.

The consequence is mild but real: a row written here appears the next time a dashboard fetches
(a refresh, a filter change, a navigation), but a tab left open beforehand keeps showing stale
data until then. `POST /api/internal/nudge` exists to close that gap: it authenticates a
shared secret and emits the event on our behalf.

This is strictly best-effort. The interaction is already committed by the time we get here, so
a failed nudge is a warning, never an error — the data is safe, the refresh is just late.
"""

import json
import urllib.error
import urllib.request
from typing import Optional

from ..config import CrmConfig


def send(cfg: CrmConfig, event_type: str = "created") -> Optional[str]:
    """
    Ping the app so open dashboards refresh. Never raises.

    Returns None on success, or a short reason string explaining why it didn't happen — the
    caller turns that into a WARN finding rather than failing the record.
    """
    if not cfg.nudge_secret:
        # Not configured: the operator opted out. Rows still appear on the next fetch.
        return "SYNC_NUDGE_SECRET not set; skipped (rows appear on next dashboard fetch)"

    url = f"{cfg.crm_base_url}/api/internal/nudge"
    body = json.dumps({"type": event_type}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "x-sync-secret": cfg.nudge_secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.nudge_timeout) as resp:
            if resp.status != 204:
                return f"nudge returned HTTP {resp.status}"
        return None
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return "nudge rejected (401): SYNC_NUDGE_SECRET does not match the app's value"
        if exc.code == 503:
            return "nudge unavailable (503): the app has no SYNC_NUDGE_SECRET configured"
        return f"nudge failed: HTTP {exc.code}"
    except urllib.error.URLError as exc:
        # Almost always "the dev server isn't running" — entirely fine for a batch job.
        return f"nudge failed: {exc.reason} (is the app running at {cfg.crm_base_url}?)"
    except OSError as exc:
        return f"nudge failed: {exc}"
