"""
Snapshots of the app's managed lookup tables, loaded once per run.

The dashboard doesn't hardcode "IRQ" or "PCR". Its metric SQL asks the registry for whatever
the row carrying role `irq` (or `pcr`) is *currently named* — see intakeNameForRole() in
app/lib/db/intakeTypes.ts. An admin can rename "IRQ" to "Inquiry" in Settings and every KPI
keeps working.

Which means a job that writes the literal string "IRQ" breaks the day someone does that,
silently: the row lands in the table, matches no KPI bucket, and nobody notices for a quarter.

So this module lets you write `intake_type="irq"` — a stable role token — and resolves it to
whatever the live display name happens to be, at write time. Names still work as input (they
are matched case-insensitively), but roles are the safe way to talk about the built-ins.

Two databases are involved, and they cannot be joined: departments / intake types / project
types / internal clients live in engagements.sqlite, while teams and the team-member roster
live in users.sqlite. Both are opened read-only.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from ..config import (
    Q_LOAD_DEPARTMENTS,
    Q_LOAD_INTAKE_TYPES,
    Q_LOAD_PROJECT_TYPES,
    Q_LOAD_ROSTER,
    Q_LOAD_TEAMS,
    CrmConfig,
)
from .connection import open_readonly


@dataclass
class Registries:
    """A point-in-time view of every managed list crm_sync validates against."""

    #: Lowercased department name -> canonical name, for case-insensitive membership tests.
    departments: Dict[str, str] = field(default_factory=dict)

    #: Lowercased intake-type name -> (canonical name, role or None).
    intake_types: Dict[str, Tuple[str, Optional[str]]] = field(default_factory=dict)
    #: role -> canonical name, e.g. 'ad_hoc' -> 'Ad-Hoc'.
    intake_by_role: Dict[str, str] = field(default_factory=dict)

    #: Lowercased project-type name -> (canonical name, role or None).
    project_types: Dict[str, Tuple[str, Optional[str]]] = field(default_factory=dict)
    project_type_by_role: Dict[str, str] = field(default_factory=dict)

    #: Lowercased team name -> canonical name (users.sqlite `teams`).
    teams: Dict[str, str] = field(default_factory=dict)

    #: Active roster display names, exactly as stored (they are matched verbatim by the app's
    #: json_each() team-member filter and by canEditEngagement, so casing matters).
    active_members: Set[str] = field(default_factory=set)
    #: display_name -> team, used to sanity-check that assignees share one team.
    member_teams: Dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, cfg: CrmConfig) -> "Registries":
        """Read every managed list. Read-only; safe to run against a live database."""
        reg = cls()

        eng = open_readonly(cfg.engagements_db, cfg)
        try:
            for row in eng.execute(Q_LOAD_DEPARTMENTS):
                reg.departments[row["name"].lower()] = row["name"]

            for row in eng.execute(Q_LOAD_INTAKE_TYPES):
                reg.intake_types[row["name"].lower()] = (row["name"], row["role"])
                if row["role"]:
                    reg.intake_by_role[row["role"]] = row["name"]

            for row in eng.execute(Q_LOAD_PROJECT_TYPES):
                reg.project_types[row["name"].lower()] = (row["name"], row["role"])
                if row["role"]:
                    reg.project_type_by_role[row["role"]] = row["name"]
        finally:
            eng.close()

        users = open_readonly(cfg.users_db, cfg)
        try:
            for row in users.execute(Q_LOAD_TEAMS):
                reg.teams[row["name"].lower()] = row["name"]

            for row in users.execute(Q_LOAD_ROSTER):
                reg.active_members.add(row["display_name"])
                reg.member_teams[row["display_name"]] = row["team"]
        finally:
            users.close()

        return reg

    # -- resolution ----------------------------------------------------------------

    def resolve_intake(self, token_or_name: str) -> Optional[Tuple[str, Optional[str]]]:
        """
        Resolve an intake type given either a role token ('irq', 'serf', 'ad_hoc') or a
        display name (matched case-insensitively).

        Returns (canonical_name, role) or None when it matches nothing. Role tokens are tried
        first, so a hypothetical custom type literally named "irq" can't shadow the built-in.
        """
        key = token_or_name.strip()
        if key.lower() in self.intake_by_role:
            name = self.intake_by_role[key.lower()]
            return (name, key.lower())
        return self.intake_types.get(key.lower())

    def resolve_project_type(self, token_or_name: str) -> Optional[Tuple[str, Optional[str]]]:
        """Same as `resolve_intake`, for the `type` column. Role token: 'pcr'."""
        key = token_or_name.strip()
        if key.lower() in self.project_type_by_role:
            name = self.project_type_by_role[key.lower()]
            return (name, key.lower())
        return self.project_types.get(key.lower())

    def resolve_department(self, name: str) -> Optional[str]:
        """Canonical department name, or None when it isn't a managed department."""
        return self.departments.get(name.strip().lower())

    def resolve_team(self, name: str) -> Optional[str]:
        """Canonical team name, or None when no such team exists."""
        return self.teams.get(name.strip().lower())

    def is_active_member(self, display_name: str) -> bool:
        return display_name in self.active_members

    def teams_of(self, display_names: List[str]) -> List[str]:
        """Distinct teams the given roster members belong to. Unknown names are skipped."""
        seen: List[str] = []
        for n in display_names:
            team = self.member_teams.get(n)
            if team and team not in seen:
                seen.append(team)
        return seen
