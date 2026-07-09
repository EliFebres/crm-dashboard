"""
Smoke test for `create_client_engagement`.

Run it directly:

    python backend/crm_sync/test.py

or as a module:

    python -m crm_sync.test

It needs `SQLITE_DIR` pointing at the folder holding engagements.sqlite / users.sqlite. In a
checkout that is already configured: `load_config()` falls back to the repo's `.env`, the
same file the Next.js app reads. Set the environment variable to override it.

What it does: inserts a client engagement with obvious dummy values, asserts the row landed
with the right defaults, asserts the two invalid-lookup cases insert nothing, and then
deletes everything it created. Cleanup runs in a `finally`, so a failed assertion still
leaves the database exactly as it was found.

It writes to whatever database SQLITE_DIR names — including a live one. Every row it creates
is tagged with the marker below and deleted by id, and the client cleanup additionally
requires `crn_pending = 1` and a name matching the marker, so it cannot remove real data.
"""

import sys
import uuid
from datetime import date
from pathlib import Path

# Allow `python backend/crm_sync/test.py`. Without this, a direct run has no package context
# and every `from .config import ...` below fails.
if not __package__:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    __package__ = "crm_sync"

from .config import TABLE_CLIENTS, TABLE_ENGAGEMENT_NOTES, TABLE_ENGAGEMENTS, TABLE_INTERNAL_CLIENTS, load_config  # noqa: E402
from .core.exceptions import ConfigError  # noqa: E402
from .db.connection import open_engagements, open_readonly, write_tx  # noqa: E402
from .db.registries import Registries  # noqa: E402
from .main import create_client_engagement  # noqa: E402

MARKER = "TEST_CLIENT_DELETE_ME"

_failures = []


def check(label: str, condition: bool, detail: str = "") -> None:
    """Record one assertion. Never raises — we want the full picture, then cleanup."""
    if condition:
        print(f"  PASS  {label}")
    else:
        print(f"  FAIL  {label}" + (f"  ({detail})" if detail else ""))
        _failures.append(label)


def _fetch(cfg, engagement_id):
    """Re-read the engagement the way the dashboard does, through a fresh connection."""
    conn = open_readonly(cfg.engagements_db, cfg)
    try:
        return conn.execute(
            f"""
            SELECT e.*, c.name AS client_name, c.crn_pending
            FROM {TABLE_ENGAGEMENTS} e
            LEFT JOIN {TABLE_CLIENTS} c ON c.crn = e.client_crn
            WHERE e.id = ?
            """,
            (engagement_id,),
        ).fetchone()
    finally:
        conn.close()


def _counts(cfg):
    """Row counts for every table the write path must NOT touch, plus the two it may."""
    conn = open_readonly(cfg.engagements_db, cfg)
    try:
        out = {}
        for table in (TABLE_ENGAGEMENTS, TABLE_CLIENTS, TABLE_INTERNAL_CLIENTS, TABLE_ENGAGEMENT_NOTES):
            out[table] = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]
        out["crm_sync_keys_exists"] = bool(
            conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='crm_sync_keys'").fetchone()
        )
        return out
    finally:
        conn.close()


def _crn_exists(cfg, crn) -> bool:
    conn = open_readonly(cfg.engagements_db, cfg)
    try:
        return bool(conn.execute(f"SELECT 1 FROM {TABLE_CLIENTS} WHERE crn = ?", (crn,)).fetchone())
    finally:
        conn.close()


def _first_internal_client(cfg):
    conn = open_readonly(cfg.engagements_db, cfg)
    try:
        return conn.execute(f"SELECT name, department FROM {TABLE_INTERNAL_CLIENTS} LIMIT 1").fetchone()
    finally:
        conn.close()


def _cleanup(cfg, engagement_ids, crns) -> None:
    """
    Delete exactly what we created, in foreign-key order: engagements reference clients.

    The client delete is guarded two ways — matched by the CRN we captured, and restricted to
    names carrying the marker — so a wrong CRN cannot take a real client with it. It does NOT
    additionally require `crn_pending = 1`: the CRN cases below register clients with a real
    CRN, and those must be cleaned up too.
    """
    if not engagement_ids and not crns:
        return
    conn = open_engagements(cfg)
    try:
        with write_tx(conn) as cur:
            for eid in engagement_ids:
                cur.execute(f"DELETE FROM {TABLE_ENGAGEMENTS} WHERE id = ?", (eid,))
            for crn in dict.fromkeys(crns):  # de-duped, order preserved
                cur.execute(
                    f"DELETE FROM {TABLE_CLIENTS} WHERE crn = ? AND name LIKE ?",
                    (crn, f"{MARKER}%"),
                )
        print(f"\nCleanup: removed {len(engagement_ids)} engagement(s), {len(set(crns))} client(s).")
    finally:
        conn.close()


def main() -> int:
    try:
        cfg = load_config()
        cfg.ensure_ready()
    except ConfigError as exc:
        print(f"CONFIG ERROR: {exc}")
        return 2

    print(f"crm_sync smoke test  (SQLITE_DIR={cfg.sqlite_dir})\n")

    reg = Registries.load(cfg)
    if not reg.intake_types or not reg.project_types:
        print("CONFIG ERROR: no intake types or project types registered; nothing to validate against.")
        return 2

    # Pull real values off the live registry so the lookup validation always passes.
    intake = sorted(entry[0] for entry in reg.intake_types.values())[0]
    ptype = sorted(entry[0] for entry in reg.project_types.values())[0]
    print(f"Using intake_type={intake!r}, project_type={ptype!r}\n")

    before = _counts(cfg)
    engagement_ids: list[int] = []
    crns: list[str] = []

    try:
        # ---- Case A: the default path — blank internal client ------------------------
        print("Case A: minimal insert, blank internal client")
        name_a = f"{MARKER} {uuid.uuid4().hex[:12]}"
        eid = create_client_engagement(external_client=name_a, intake_type=intake, project_type=ptype)
        engagement_ids.append(eid)
        row = _fetch(cfg, eid)
        crns.append(row["client_crn"])

        check("returns an integer id", isinstance(eid, int) and eid > 0, f"got {eid!r}")
        check("row is readable from a fresh connection", row is not None)
        check("status == 'In Progress'", row["status"] == "In Progress", repr(row["status"]))
        check("date_started == today", row["date_started"] == date.today().isoformat(), repr(row["date_started"]))
        check("date_finished IS NULL", row["date_finished"] is None, repr(row["date_finished"]))
        check("team_members == '[]'", row["team_members"] == "[]", repr(row["team_members"]))
        check("team IS NULL (unassigned)", row["team"] is None, repr(row["team"]))
        check("internal_client_name is blank", row["internal_client_name"] == "", repr(row["internal_client_name"]))
        check("internal_client_dept is blank", row["internal_client_dept"] == "", repr(row["internal_client_dept"]))
        check("department is blank", row["department"] == "", repr(row["department"]))
        check("intake_type resolved", row["intake_type"] == intake, repr(row["intake_type"]))
        check("project type resolved into `type`", row["type"] == ptype, repr(row["type"]))
        check("client JOIN resolves the name", row["client_name"] == name_a, repr(row["client_name"]))
        check("client_crn is a placeholder", str(row["client_crn"]).startswith("PENDING-"), repr(row["client_crn"]))
        check("client is flagged crn_pending", row["crn_pending"] == 1, repr(row["crn_pending"]))
        check("nna left NULL", row["nna"] is None, repr(row["nna"]))
        check("notes left NULL", row["notes"] is None, repr(row["notes"]))
        check("portfolio_logged defaults to 0", row["portfolio_logged"] == 0, repr(row["portfolio_logged"]))
        check("ad_hoc_channel left NULL", row["ad_hoc_channel"] is None, repr(row["ad_hoc_channel"]))
        check("filepath left NULL", row["filepath"] is None, repr(row["filepath"]))
        check("linked_from_id left NULL", row["linked_from_id"] is None, repr(row["linked_from_id"]))

        # ---- Case B: a known internal client contributes its department --------------
        print("\nCase B: known internal client propagates its department")
        ic = _first_internal_client(cfg)
        if ic is None:
            print("  SKIP  no internal_clients registered")
        else:
            name_b = f"{MARKER} {uuid.uuid4().hex[:12]}"
            eid_b = create_client_engagement(
                external_client=name_b, intake_type=intake, project_type=ptype, internal_client=ic["name"]
            )
            engagement_ids.append(eid_b)
            row_b = _fetch(cfg, eid_b)
            crns.append(row_b["client_crn"])
            check("internal_client_name kept", row_b["internal_client_name"] == ic["name"], repr(row_b["internal_client_name"]))
            check("internal_client_dept inherited", row_b["internal_client_dept"] == ic["department"], repr(row_b["internal_client_dept"]))
            check("department mirrors it", row_b["department"] == ic["department"], repr(row_b["department"]))

        # ---- Case C: an unregistered internal client is blanked, not an error --------
        print("\nCase C: unregistered internal client is stored blank, without raising")
        name_c = f"{MARKER} {uuid.uuid4().hex[:12]}"
        eid_c = create_client_engagement(
            external_client=name_c, intake_type=intake, project_type=ptype,
            internal_client="NO_SUCH_INTERNAL_CLIENT_XYZ",
        )
        engagement_ids.append(eid_c)
        row_c = _fetch(cfg, eid_c)
        crns.append(row_c["client_crn"])
        check("internal_client_name blanked", row_c["internal_client_name"] == "", repr(row_c["internal_client_name"]))
        check("internal_client_dept blanked", row_c["internal_client_dept"] == "", repr(row_c["internal_client_dept"]))

        # ---- Case D: a supplied CRN registers a brand-new client with it -------------
        print("\nCase D: supplied CRN is used to register a new client")
        name_d = f"{MARKER} {uuid.uuid4().hex[:12]}"
        crn_d = f"CRN-TEST-{uuid.uuid4().hex[:8].upper()}"
        eid_d = create_client_engagement(external_client=name_d, intake_type=intake, project_type=ptype, crn=crn_d)
        engagement_ids.append(eid_d)
        row_d = _fetch(cfg, eid_d)
        crns.append(row_d["client_crn"])
        check("engagement uses the supplied CRN", row_d["client_crn"] == crn_d, repr(row_d["client_crn"]))
        check("client is NOT flagged crn_pending", row_d["crn_pending"] == 0, repr(row_d["crn_pending"]))
        check("client JOIN resolves the name", row_d["client_name"] == name_d, repr(row_d["client_name"]))

        # ---- Case E: an existing client keeps its CRN, whatever was supplied ---------
        # This is the whole point of resolving by name before touching the supplied CRN.
        print("\nCase E: a registered client keeps its own CRN; a supplied CRN is ignored")
        clients_before_e = _counts(cfg)[TABLE_CLIENTS]
        other_crn = f"CRN-OTHER-{uuid.uuid4().hex[:8].upper()}"
        eid_e = create_client_engagement(
            external_client=name_d.lower(),   # same client, different casing
            intake_type=intake, project_type=ptype, crn=other_crn,
        )
        engagement_ids.append(eid_e)
        row_e = _fetch(cfg, eid_e)
        check("reuses the registered CRN", row_e["client_crn"] == crn_d, repr(row_e["client_crn"]))
        check("supplied CRN was not stored", row_e["client_crn"] != other_crn, repr(row_e["client_crn"]))
        check("no second client registered", _counts(cfg)[TABLE_CLIENTS] == clients_before_e,
              f"{clients_before_e} -> {_counts(cfg)[TABLE_CLIENTS]}")
        check("the ignored CRN exists nowhere", not _crn_exists(cfg, other_crn))

        # ---- Case F: a CRN owned by another client wins over a new name --------------
        # The CRN is the identity; the registry's name is what the dashboard displays. The
        # engagement is filed against the CRN's owner and the new name is discarded.
        print("\nCase F: a supplied CRN owned by another client wins over a new name")
        clients_before_f = _counts(cfg)[TABLE_CLIENTS]
        name_f = f"{MARKER} {uuid.uuid4().hex[:12]}"
        eid_f = create_client_engagement(
            external_client=name_f, intake_type=intake, project_type=ptype, crn=crn_d
        )
        engagement_ids.append(eid_f)
        row_f = _fetch(cfg, eid_f)
        check("filed against the CRN's owner", row_f["client_crn"] == crn_d, repr(row_f["client_crn"]))
        check("registry name wins over the supplied one", row_f["client_name"] == name_d, repr(row_f["client_name"]))
        check("no client registered for the discarded name", _counts(cfg)[TABLE_CLIENTS] == clients_before_f,
              f"{clients_before_f} -> {_counts(cfg)[TABLE_CLIENTS]}")

        # ---- Negative cases: invalid lookups insert nothing --------------------------
        print("\nNegative cases: bad lookups raise ValueError and write nothing")
        mid = _counts(cfg)

        try:
            create_client_engagement(f"{MARKER} never", intake, ptype, crn="!!bad crn!!")
            check("malformed CRN raises ValueError", False, "no exception raised")
        except ValueError as exc:
            check("malformed CRN raises ValueError", True)
            check("  message names the bad value", "!!bad crn!!" in str(exc), str(exc))

        try:
            create_client_engagement(f"{MARKER} never", "NOT_AN_INTAKE_TYPE", ptype)
            check("bad intake_type raises ValueError", False, "no exception raised")
        except ValueError as exc:
            msg = str(exc)
            check("bad intake_type raises ValueError", True)
            check("  message names the bad value", "NOT_AN_INTAKE_TYPE" in msg, msg)
            check("  message lists valid options", intake in msg, msg)

        try:
            create_client_engagement(f"{MARKER} never", intake, "NOT_A_PROJECT_TYPE")
            check("bad project_type raises ValueError", False, "no exception raised")
        except ValueError as exc:
            msg = str(exc)
            check("bad project_type raises ValueError", True)
            check("  message names the bad value", "NOT_A_PROJECT_TYPE" in msg, msg)
            check("  message lists valid options", ptype in msg, msg)

        try:
            create_client_engagement("   ", intake, ptype)
            check("blank external_client raises ValueError", False, "no exception raised")
        except ValueError:
            check("blank external_client raises ValueError", True)

        try:
            create_client_engagement(f"{MARKER} never", intake, ptype, date_finished="not-a-date")
            check("garbage date_finished raises ValueError", False, "no exception raised")
        except ValueError:
            check("garbage date_finished raises ValueError", True)

        after_neg = _counts(cfg)
        check("no engagement inserted by the failures",
              after_neg[TABLE_ENGAGEMENTS] == mid[TABLE_ENGAGEMENTS],
              f"{mid[TABLE_ENGAGEMENTS]} -> {after_neg[TABLE_ENGAGEMENTS]}")
        check("no client registered by the failures",
              after_neg[TABLE_CLIENTS] == mid[TABLE_CLIENTS],
              f"{mid[TABLE_CLIENTS]} -> {after_neg[TABLE_CLIENTS]}")

        # ---- Side effects: the write path touches only engagements + clients ---------
        print("\nSide effects: no other table was written")
        now = _counts(cfg)
        check("internal_clients unchanged",
              now[TABLE_INTERNAL_CLIENTS] == before[TABLE_INTERNAL_CLIENTS],
              f"{before[TABLE_INTERNAL_CLIENTS]} -> {now[TABLE_INTERNAL_CLIENTS]}")
        check("engagement_notes unchanged",
              now[TABLE_ENGAGEMENT_NOTES] == before[TABLE_ENGAGEMENT_NOTES],
              f"{before[TABLE_ENGAGEMENT_NOTES]} -> {now[TABLE_ENGAGEMENT_NOTES]}")
        check("crm_sync_keys not created",
              now["crm_sync_keys_exists"] == before["crm_sync_keys_exists"],
              f"{before['crm_sync_keys_exists']} -> {now['crm_sync_keys_exists']}")

    except Exception as exc:  # noqa: BLE001 — report, then always clean up
        print(f"\n  FAIL  unexpected {type(exc).__name__}: {exc}")
        _failures.append(f"unexpected {type(exc).__name__}")
    finally:
        _cleanup(cfg, engagement_ids, crns)

    # ---- did cleanup restore the baseline? -------------------------------------------
    final = _counts(cfg)
    restored = all(final[t] == before[t] for t in (TABLE_ENGAGEMENTS, TABLE_CLIENTS, TABLE_INTERNAL_CLIENTS, TABLE_ENGAGEMENT_NOTES))
    check("database restored to baseline row counts", restored, f"{before} -> {final}")

    print()
    if _failures:
        print(f"FAILED - {len(_failures)} check(s): {', '.join(_failures)}")
        return 1
    print("PASSED - all checks green, test rows removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
