"""
Pre-write validation.

The app's own POST route validates almost nothing beyond the client CRN — it trusts its React
form to have done that. Writing straight to SQLite means there is no form, so this module is
the only thing between a typo in a fetch script and a permanently wrong row.

Every check exists because a specific value produces a specific *silent* failure: the INSERT
succeeds, no error is raised anywhere, and the interaction is subtly missing from the surface
someone relies on. The failure each check prevents is named in its finding message.

`validate()` is pure — it reads registries and returns findings plus a normalized copy of the
record. It never touches the database and never mutates its input.
"""

import re
from copy import deepcopy
from datetime import datetime
from typing import List, Optional, Tuple

from ..config import AD_HOC_CHANNELS, VALID_STATUSES, COMPLETED_STATUSES, CrmConfig
from ..core.models import ClientInteraction, Finding, Severity
from ..db.crn import is_valid_crn, normalize_crn
from ..db.registries import Registries

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: Display formats the app's toISODate() accepts, so we accept them too.
_DISPLAY_FORMATS = ("%b %d, %Y", "%B %d, %Y", "%m/%d/%Y", "%Y/%m/%d")


def normalize_date(value: Optional[str]) -> Optional[str]:
    """
    Coerce a date to 'YYYY-MM-DD', or return None when it is empty / the app's em-dash
    placeholder for "not finished".

    Returns None for anything unparseable too — callers distinguish "absent" from "garbage"
    by checking whether the input was truthy. The app compares `date_started` as a *string*
    in its period filters (`date_started >= '2025-01-01'`), so a non-ISO value doesn't error,
    it just sorts and filters wrong. Hence: normalize, or refuse.
    """
    if not value or value == "—":  # em-dash
        return None
    value = value.strip()
    if _ISO_DATE.match(value):
        return value
    for fmt in _DISPLAY_FORMATS:
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _err(fieldname: str, code: str, message: str) -> Finding:
    return Finding(fieldname, code, Severity.ERROR, message)


def _warn(fieldname: str, code: str, message: str) -> Finding:
    return Finding(fieldname, code, Severity.WARN, message)


def _info(fieldname: str, code: str, message: str) -> Finding:
    return Finding(fieldname, code, Severity.INFO, message)


def _registry_severity(cfg: CrmConfig) -> Severity:
    """
    Membership in a managed registry is an ERROR in strict mode, a WARN in lenient mode.

    Strict is right by default because the app cannot recover from an unknown type name. Its
    bootstrap does back-fill orphan values into the registry on the next restart — but with
    `role = NULL` (app/lib/db/index.ts). A type that *should* behave as ad-hoc, registered
    without the ad_hoc role, is broken forever: no restart, no admin action in Settings, will
    ever restore its role. Better to refuse the write and make a human register it properly.
    """
    return Severity.ERROR if cfg.strict else Severity.WARN


def validate(
    interaction: ClientInteraction,
    reg: Registries,
    cfg: CrmConfig,
) -> Tuple[ClientInteraction, List[Finding]]:
    """
    Check a record and return `(normalized_copy, findings)`.

    The normalized copy has: canonical intake/project-type names resolved from role tokens,
    dates coerced to ISO, the CRN uppercased, `department` defaulted from the internal
    client's department, and blank roster entries stripped.

    Callers decide what to do with ERROR findings; `EngagementWriter` raises `ValidationError`
    on them when `cfg.strict`. Nothing here writes or raises.
    """
    n = deepcopy(interaction)
    findings: List[Finding] = []
    reg_sev = _registry_severity(cfg)

    # -- identity ------------------------------------------------------------------
    n.client_name = (n.client_name or "").strip()
    if not n.client_name:
        findings.append(_err("client_name", "client_name_missing", "External client name is required."))

    n.internal_client_name = (n.internal_client_name or "").strip()
    if not n.internal_client_name:
        findings.append(
            _err("internal_client_name", "internal_client_missing",
                 "Internal client name is required (the column is NOT NULL).")
        )

    if n.client_crn:
        n.client_crn = normalize_crn(n.client_crn)
        if not is_valid_crn(n.client_crn):
            findings.append(
                _err("client_crn", "crn_malformed",
                     f"'{n.client_crn}' is not a valid CRN. Expected 3-32 uppercase "
                     f"alphanumerics/dashes, starting alphanumeric.")
            )

    # -- department ----------------------------------------------------------------
    dept = (n.internal_client_dept or "").strip()
    if not dept:
        findings.append(
            _err("internal_client_dept", "department_missing", "Internal client department is required.")
        )
    else:
        canonical = reg.resolve_department(dept)
        if canonical is None:
            findings.append(
                Finding("internal_client_dept", "department_unknown", reg_sev,
                        f"'{dept}' is not a managed department. Register it in Settings first, "
                        f"or the department breakdown chart will render it as an unmanaged grey slice. "
                        f"Known: {', '.join(sorted(reg.departments.values()))}")
            )
        else:
            dept = canonical
    n.internal_client_dept = dept
    # The engagement's own `department` column mirrors the internal client's, exactly as the
    # app's POST route does (`body.internalClient?.clientDept ?? body.department`).
    n.department = (n.department or dept).strip()

    # -- intake type (role-aware) --------------------------------------------------
    intake_role: Optional[str] = None
    raw_intake = (n.intake_type or "").strip()
    if not raw_intake:
        findings.append(_err("intake_type", "intake_type_missing", "Intake type is required."))
    else:
        resolved = reg.resolve_intake(raw_intake)
        if resolved is None:
            findings.append(
                Finding("intake_type", "intake_type_unknown", reg_sev,
                        f"'{raw_intake}' matches no intake type. Pass a role token "
                        f"('irq', 'serf', 'ad_hoc') or a registered name. An unknown name is "
                        f"back-filled with role=NULL on the next server restart and can never "
                        f"drive KPI buckets again. Known: {', '.join(sorted(v[0] for v in reg.intake_types.values()))}")
            )
        else:
            n.intake_type, intake_role = resolved

    # -- project type (role-aware) -------------------------------------------------
    raw_type = (n.project_type or "").strip()
    if not raw_type:
        findings.append(_err("project_type", "project_type_missing", "Project type is required."))
    else:
        resolved_pt = reg.resolve_project_type(raw_type)
        if resolved_pt is None:
            findings.append(
                Finding("project_type", "project_type_unknown", reg_sev,
                        f"'{raw_type}' matches no project type. Pass the role token 'pcr' or a "
                        f"registered name. Known: {', '.join(sorted(v[0] for v in reg.project_types.values()))}")
            )
        else:
            n.project_type = resolved_pt[0]

    # -- ad hoc channel ------------------------------------------------------------
    # Only interactions whose intake type carries the `ad_hoc` role have a channel. The metric
    # SQL counts channels with `intake_type = <ad_hoc name> AND ad_hoc_channel = 'Email'`, so a
    # channel on a non-ad-hoc row is dead data, and a missing one on an ad-hoc row is a hole in
    # the Ad-Hoc breakdown chart. Neither is fatal, so: warn.
    if intake_role == "ad_hoc":
        if not n.ad_hoc_channel:
            findings.append(
                _warn("ad_hoc_channel", "ad_hoc_channel_missing",
                      "Ad-Hoc interaction has no channel; it will be missing from the Ad-Hoc "
                      f"intake breakdown. Expected one of: {', '.join(AD_HOC_CHANNELS)}")
            )
        elif n.ad_hoc_channel not in AD_HOC_CHANNELS:
            findings.append(
                _warn("ad_hoc_channel", "ad_hoc_channel_invalid",
                      f"'{n.ad_hoc_channel}' is not a known channel; expected one of: "
                      f"{', '.join(AD_HOC_CHANNELS)}")
            )
    elif n.ad_hoc_channel:
        findings.append(
            _info("ad_hoc_channel", "ad_hoc_channel_ignored",
                  f"ad_hoc_channel is set but the intake type is not Ad-Hoc; the dashboard ignores it.")
        )
        n.ad_hoc_channel = None

    # -- status --------------------------------------------------------------------
    # Always an ERROR, in both modes. A status outside this set matches neither OPEN_STATUSES
    # nor COMPLETED_STATUSES, so the row is invisible to every KPI while sitting in the table
    # looking perfectly fine. There is no lenient reading of that.
    if n.status not in VALID_STATUSES:
        findings.append(
            _err("status", "status_invalid",
                 f"'{n.status}' is not a valid status. The row would drop out of every KPI "
                 f"bucket. Expected one of: {', '.join(VALID_STATUSES)}")
        )

    # -- dates ---------------------------------------------------------------------
    started = normalize_date(n.date_started)
    if started is None:
        findings.append(
            _err("date_started", "date_started_invalid",
                 f"Could not parse date_started={n.date_started!r}. Period filters compare this "
                 f"column as a string, so a non-ISO value silently breaks filtering and sorting.")
        )
    else:
        n.date_started = started

    if n.date_finished:
        finished = normalize_date(n.date_finished)
        if finished is None:
            findings.append(
                Finding("date_finished", "date_finished_invalid",
                        Severity.ERROR if cfg.strict else Severity.WARN,
                        f"Could not parse date_finished={n.date_finished!r}.")
            )
        else:
            n.date_finished = finished
            if n.status not in COMPLETED_STATUSES:
                findings.append(
                    _warn("date_finished", "finished_but_open",
                          f"date_finished is set but status is '{n.status}', which is not a "
                          f"completed status. The completion heatmap keys off date_finished.")
                )

    # -- ownership: unassigned is the expected shape for automation -----------------
    if n.team is None:
        findings.append(
            _info("team", "unassigned_team",
                  "No team: this interaction lands in the global unassigned inbox, visible to "
                  "every user, and moves into a team when someone claims it.")
        )
    else:
        canonical_team = reg.resolve_team(n.team)
        if canonical_team is None:
            findings.append(
                Finding("team", "team_unknown", reg_sev,
                        f"'{n.team}' is not a real team. The dashboard filters on "
                        f"`team = <the viewer's team>`, so a team nobody belongs to makes this row "
                        f"invisible to every non-admin, while still counting in admin views. "
                        f"Known: {', '.join(sorted(reg.teams.values()))}. "
                        f"Leave team unset to file it as unassigned instead.")
            )
        else:
            n.team = canonical_team

    n.team_members = [m.strip() for m in (n.team_members or []) if m and m.strip()]
    if not n.team_members:
        findings.append(
            _info("team_members", "unassigned_roster",
                  "No assignees: renders with the yellow 'Unassigned' badge and can be claimed "
                  "by any user from the dashboard.")
        )
    else:
        unknown = [m for m in n.team_members if not reg.is_active_member(m)]
        if unknown:
            findings.append(
                _warn("team_members", "member_unknown",
                      f"Not active roster members: {', '.join(unknown)}. Assignee names are matched "
                      f"verbatim, so a typo means nobody but an admin can ever edit this row. "
                      f"Names look like 'Alex M.' (first name + last initial).")
            )
        spanned = reg.teams_of(n.team_members)
        if len(spanned) > 1:
            findings.append(
                _warn("team_members", "members_span_teams",
                      f"Assignees span multiple teams ({', '.join(spanned)}), but an engagement "
                      f"has one team. The dashboard's assign flow refuses this.")
            )
        if n.team is None:
            findings.append(
                _warn("team_members", "assigned_but_teamless",
                      "Assignees are set but team is None. The row is visible to everyone and "
                      "credits no team's KPIs. Set `team` to the assignees' team.")
            )
        elif spanned and n.team not in spanned:
            findings.append(
                _warn("team", "team_mismatch",
                      f"team='{n.team}' but the assignees belong to {', '.join(spanned)}. "
                      f"They will not see their own work.")
            )

    # -- misc payload --------------------------------------------------------------
    if n.nna is not None and (not isinstance(n.nna, int) or isinstance(n.nna, bool)):
        findings.append(_warn("nna", "nna_not_int", f"nna should be a whole-dollar int, got {type(n.nna).__name__}."))

    if n.tickers_mentioned is not None:
        if not isinstance(n.tickers_mentioned, list) or any(not isinstance(t, str) for t in n.tickers_mentioned):
            findings.append(_warn("tickers_mentioned", "tickers_not_str_list", "tickers_mentioned should be a list of strings."))
        else:
            n.tickers_mentioned = [t.strip().upper() for t in n.tickers_mentioned if t.strip()] or None

    if n.linked_from_id is not None:
        if not isinstance(n.linked_from_id, int) or isinstance(n.linked_from_id, bool) or n.linked_from_id <= 0:
            findings.append(
                Finding("linked_from_id", "linked_from_id_invalid",
                        Severity.ERROR if cfg.strict else Severity.WARN,
                        f"linked_from_id must be a positive engagement id, got {n.linked_from_id!r}.")
            )

    return n, findings
