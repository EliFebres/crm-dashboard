"""
Post-write verification: prove the interaction will actually show up on the dashboard.

A successful INSERT means almost nothing. SQLite will happily store a row whose client CRN
matches no client, whose team matches no team, whose status matches no KPI bucket, and whose
start date sorts as a string in an order nobody expects. Every one of those produces a row
that *exists*, reports no error, and is missing or wrong on the surface a department reads.

So after the transaction commits, we go back and re-query the row the way the dashboard
queries it — through the same `LEFT JOIN clients` (CLIENT_JOIN in app/lib/db/queries.ts),
against the same team predicate `buildFilterClause` applies — and assert it will render.

Deliberately done over a *fresh, read-only connection*, not the writer's. That makes the check
independent of the writing transaction and proves the row is durable and visible to other
processes — which is the actual claim, since the Next.js server is a different process.
"""

import re
import sqlite3
from typing import List, Optional

from ..config import (
    TABLE_CLIENTS,
    TABLE_ENGAGEMENTS,
    TABLE_INTAKE_TYPES,
    TABLE_PROJECT_TYPES,
    TABLE_TEAM_MEMBERS,
    TABLE_TEAMS,
    VALID_STATUSES,
    CrmConfig,
)
from ..core.models import Finding, Severity
from .connection import open_readonly

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _err(fieldname: str, code: str, message: str) -> Finding:
    return Finding(fieldname, code, Severity.ERROR, message)


def verify_visible(cfg: CrmConfig, engagement_id: int) -> List[Finding]:
    """
    Re-read engagement `engagement_id` and return the findings that would keep it off the
    dashboard. An empty list means the row is good.

    Every finding here is an ERROR: the row is already committed, so there is nothing to
    prevent — only something to shout about.
    """
    findings: List[Finding] = []

    eng = open_readonly(cfg.engagements_db, cfg)
    users = open_readonly(cfg.users_db, cfg)
    try:
        # The dashboard's own SELECT shape: engagements LEFT JOIN clients ON c.crn = e.client_crn.
        row: Optional[sqlite3.Row] = eng.execute(
            f"""
            SELECT e.id, e.client_crn, e.team, e.team_members, e.status,
                   e.date_started, e.intake_type, e.type,
                   c.name AS client_name
            FROM {TABLE_ENGAGEMENTS} e
            LEFT JOIN {TABLE_CLIENTS} c ON c.crn = e.client_crn
            WHERE e.id = ?
            """,
            (engagement_id,),
        ).fetchone()

        # 1. The row committed and is visible from another connection.
        if row is None:
            return [
                _err("id", "row_missing",
                     f"Engagement #{engagement_id} is not readable from a fresh connection after "
                     f"commit. The transaction did not durably land.")
            ]

        # 2. The client JOIN resolves. A NULL name here means client_crn points at nothing — the
        #    exact damage an unenforced foreign key does (Python's sqlite3 leaves foreign_keys
        #    OFF unless asked). The row would render with a blank external client, forever.
        if row["client_name"] is None:
            findings.append(
                _err("client_crn", "client_unresolved",
                     f"client_crn={row['client_crn']!r} matches no row in `clients`, so the "
                     f"dashboard will show a blank external client. PRAGMA foreign_keys was "
                     f"likely off during the write.")
            )

        # 3. Team visibility. buildFilterClause scopes non-admin users with
        #    `(team = <their team> OR team IS NULL)`. NULL is the unassigned inbox — correct and
        #    intended. A non-NULL team that doesn't exist matches nobody's predicate, so the row
        #    is invisible to every regular user while admins still see it: the nastiest possible
        #    failure, because it looks fine to whoever checks.
        team = row["team"]
        if team is not None:
            known = users.execute(
                f"SELECT 1 FROM {TABLE_TEAMS} WHERE name = ? COLLATE NOCASE LIMIT 1", (team,)
            ).fetchone()
            if not known:
                findings.append(
                    _err("team", "team_unknown",
                         f"team={team!r} is not a real team. Every non-admin filters on their own "
                         f"team name, so nobody on the floor will see this interaction.")
                )

        # 4. Status lands in a KPI bucket (OPEN_STATUSES or COMPLETED_STATUSES).
        if row["status"] not in VALID_STATUSES:
            findings.append(
                _err("status", "status_invalid",
                     f"status={row['status']!r} is outside VALID_STATUSES, so this interaction is "
                     f"counted by no KPI. Expected one of: {', '.join(VALID_STATUSES)}")
            )

        # 5. date_started is ISO. Period filters compare it as a string.
        if not row["date_started"] or not _ISO_DATE.match(row["date_started"]):
            findings.append(
                _err("date_started", "date_started_not_iso",
                     f"date_started={row['date_started']!r} is not YYYY-MM-DD; period filters and "
                     f"sorting compare this column lexically and will misplace the row.")
            )

        # 6. The intake/project type names still exist in the registries. Catches the narrow race
        #    where an admin renames a type between validation and commit — the write would store
        #    the now-stale name, which resolves to no registry row and no chart color.
        for column, table, fieldname in (
            (row["intake_type"], TABLE_INTAKE_TYPES, "intake_type"),
            (row["type"], TABLE_PROJECT_TYPES, "project_type"),
        ):
            hit = eng.execute(f"SELECT 1 FROM {table} WHERE name = ? COLLATE NOCASE LIMIT 1", (column,)).fetchone()
            if not hit:
                findings.append(
                    _err(fieldname, f"{fieldname}_unregistered",
                         f"{fieldname}={column!r} matches no row in `{table}` — it was probably "
                         f"renamed mid-run. Charts will render it as an unmanaged value.")
                )

        # 7. Editability. Not fatal (unassigned rows are supposed to have an empty roster), so a
        #    warning: if a roster *is* set, at least one name must be a real active member, or
        #    only admins will be able to touch the row.
        import json as _json

        members = _json.loads(row["team_members"] or "[]")
        if members:
            placeholders = ", ".join("?" for _ in members)
            live = users.execute(
                f"SELECT COUNT(*) AS c FROM {TABLE_TEAM_MEMBERS} "
                f"WHERE display_name IN ({placeholders}) AND status = 'active'",
                members,
            ).fetchone()
            if live["c"] == 0:
                findings.append(
                    Finding("team_members", "no_live_assignee", Severity.WARN,
                            f"None of {members} is an active roster member, so only an admin can "
                            f"edit this interaction.")
                )
    finally:
        eng.close()
        users.close()

    return findings
