"""
A worked example of an automation job. Copy this file, replace `fetch_records`, ship it.

The contract is one function: produce `ClientInteraction` objects. Where they come from —
a vendor API, an Excel drop folder, a shared mailbox, a database view — is entirely yours.
Everything downstream (validation, CRN resolution, the transaction, verification, alerting)
is handled for you.

Run it:

    set SQLITE_DIR=D:\\Data\\CRM
    python -m crm_sync.tests.example_job --dry-run   # validate against live registries, write nothing
    python -m crm_sync.tests.example_job             # write for real

For a single interaction you do not need any of this — call
`crm_sync.create_client_engagement()` instead. This example is the batch path: idempotency,
per-record failure isolation, dry runs, and alert sinks.

Exit codes: 0 clean, 1 some records failed, 2 couldn't start, 3 everything failed.
"""

import argparse
import sys
from typing import Iterator

from .. import ClientInteraction, ConfigError, CrmSync, EXIT_STARTUP_FAILURE  # noqa: F401


def fetch_records() -> Iterator[ClientInteraction]:
    """
    >>> REPLACE THIS WITH YOUR OWN DATA-FETCHING CODE <<<

    Yield one `ClientInteraction` per interaction you want created. Yielding (rather than
    returning a list) lets a large pull stream through the writer instead of sitting in memory.

    Notes on the fields below, because two of them are easy to get subtly wrong:

      * `intake_type` / `project_type` take *role tokens* ('irq', 'serf', 'ad_hoc', 'pcr') as
        well as display names. Prefer the tokens. An admin renaming "IRQ" to "Inquiry" in
        Settings would otherwise leave this job writing a name that matches no KPI bucket, and
        nothing would tell you.

      * `team` and `team_members` are omitted on purpose. The interaction lands unassigned:
        visible to everyone, badged yellow, and claimable with one click from the dashboard.
        Only set them when the job genuinely knows who owns the work.
    """
    yield ClientInteraction(
        client_name="Acme Retirement Trust",
        client_crn="CRN-000042",          # the real CRN from your upstream system...
        internal_client_name="Acme 401k",
        internal_client_dept="Retirement",
        intake_type="serf",
        project_type="Data Request",
        status="In Progress",
        notes="Imported automatically from the intake queue.",
        dedupe_key="intake-queue:47182",  # your source's stable id — better than the derived hash
    )

    yield ClientInteraction(
        client_name="Northwind Advisors",
        client_pending=True,              # ...or register a PENDING- placeholder when you don't have it
        internal_client_name="Northwind Core",
        internal_client_dept="Advisory",
        intake_type="ad_hoc",
        ad_hoc_channel="Email",
        project_type="Meeting",
        tickers_mentioned=["AAPL", "MSFT"],
        dedupe_key="mailbox:2026-07-09:northwind-1",
    )


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Sync client interactions into the CRM dashboard.")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Validate every record against the live registries and write nothing.",
    )
    parser.add_argument(
        "--lenient", action="store_true",
        help="Downgrade registry-membership errors to warnings and write anyway. "
             "Status and date errors still block — those make a row invisible.",
    )
    args = parser.parse_args(argv)

    try:
        sync = CrmSync.from_env(strict=not args.lenient)
    except ConfigError as exc:
        # Couldn't even start: no database, no point retrying per-record.
        print(f"[crm_sync] startup failed: {exc}", file=sys.stderr)
        return EXIT_STARTUP_FAILURE

    with sync:
        # Route alerts wherever your team actually looks. Console is on by default; add
        # a webhook or your own callable:
        #
        #     from crm_sync import WebhookAlertSink, CallableAlertSink
        #     sync.add_alert_sink(WebhookAlertSink("https://hooks.slack.com/services/..."))
        #     sync.add_alert_sink(CallableAlertSink(lambda alert: send_email(alert.render())))

        if args.dry_run:
            return sync.dry_run(fetch_records()).exit_code
        return sync.run_batch(fetch_records()).exit_code


if __name__ == "__main__":
    sys.exit(main())
