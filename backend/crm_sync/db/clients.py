"""
Get-or-create for the external client registry.

`engagements.client_crn` is a foreign key into `clients`, and the dashboard resolves the
client's display name by joining through it — the name is never stored on the engagement. So
every interaction needs a CRN that already exists, and this module is what makes one exist.

Mirrors the logic of the app's own POST /api/client-interactions/clients route, including its
409 semantics, but composes it into the same transaction as the engagement insert. (The app
keeps them separate because its React form registers the client in a prior request.)

All functions here must be called from inside an open `BEGIN IMMEDIATE` transaction.
"""

import sqlite3
from dataclasses import dataclass, field
from typing import List, Optional

from ..config import TABLE_CLIENTS, CrmConfig
from ..core.exceptions import ClientConflictError, CrnRequiredError, InvalidCrnError
from ..core.models import Finding, Severity
from .crn import generate_next_crn, generate_pending_crn, is_valid_crn, normalize_crn


@dataclass
class ResolvedClient:
    crn: str
    name: str
    #: True when this call inserted the client rather than finding it.
    created: bool = False
    #: True when `crn` is a PENDING-###### placeholder awaiting a real value.
    pending: bool = False
    findings: List[Finding] = field(default_factory=list)


def resolve_or_create_client(
    cur: sqlite3.Cursor,
    *,
    name: str,
    cfg: CrmConfig,
    crn: Optional[str] = None,
    pending: bool = False,
    created_by_id: str,
    created_by_name: str,
) -> ResolvedClient:
    """
    Find the external client, or register it, and return its CRN.

    Name matching is case-insensitive throughout, because `clients` carries a
    `UNIQUE INDEX ... (name COLLATE NOCASE)`. A plain `WHERE name = ?` would miss "acme corp"
    when "Acme Corp" is registered, and the subsequent INSERT would then blow up on that index.

    The four paths, in the order they're tried:

      1. An explicit `crn` that already exists  -> reuse it. If the registered name differs
         from `name`, warn: the registry's name wins (it's what the dashboard JOINs to), so
         the caller's name is silently discarded and they should know.
      2. No `crn`, but `name` is already registered -> reuse that client's CRN. This is the
         common path for a job that only knows client names.
      3. A brand-new client, with `auto_generate` on -> mint the next sequential CRN.
      4. A brand-new client, with `auto_generate` off (today's setting) -> either the caller
         supplied a CRN (insert with it), or `pending=True` mints a PENDING-###### placeholder,
         or we refuse: we have no basis for inventing an identifier the firm's other systems
         are supposed to own.

    Raises:
        InvalidCrnError: an explicit CRN that doesn't match the configured format.
        ClientConflictError: the name is registered under a different CRN.
        CrnRequiredError: a new client with no CRN, no pending flag, and auto-generation off.
    """
    findings: List[Finding] = []
    name = name.strip()

    # ---- 1. explicit CRN --------------------------------------------------------
    if crn:
        crn = normalize_crn(crn)
        if not is_valid_crn(crn):
            raise InvalidCrnError(f"'{crn}' is not a valid CRN.")

        existing = cur.execute(
            f"SELECT crn, name, crn_pending FROM {TABLE_CLIENTS} WHERE crn = ?", (crn,)
        ).fetchone()
        if existing:
            if existing["name"].lower() != name.lower():
                findings.append(
                    Finding(
                        "client_name", "client_name_drift", Severity.WARN,
                        f"CRN {crn} is registered as '{existing['name']}', not '{name}'. The "
                        f"registry name is what the dashboard displays; '{name}' is ignored.",
                    )
                )
            return ResolvedClient(
                crn=existing["crn"], name=existing["name"],
                pending=bool(existing["crn_pending"]), findings=findings,
            )

        # New CRN. The unique-nocase name index will reject a duplicate name, so check first
        # and raise something intelligible instead of an IntegrityError.
        if not name:
            raise ClientConflictError(f"CRN {crn} is new, so an external client name is required to register it.")
        name_owner = cur.execute(
            f"SELECT crn FROM {TABLE_CLIENTS} WHERE name = ? COLLATE NOCASE", (name,)
        ).fetchone()
        if name_owner:
            raise ClientConflictError(
                f"'{name}' is already registered under CRN {name_owner['crn']}, not {crn}."
            )

        cur.execute(
            f"INSERT INTO {TABLE_CLIENTS} (crn, name, crn_pending, created_by_id, created_by_name) "
            f"VALUES (?, ?, 0, ?, ?)",
            (crn, name, created_by_id, created_by_name),
        )
        return ResolvedClient(crn=crn, name=name, created=True, findings=findings)

    # ---- 2. known name ----------------------------------------------------------
    if not name:
        raise ClientConflictError("An external client name is required when no CRN is supplied.")

    by_name = cur.execute(
        f"SELECT crn, name, crn_pending FROM {TABLE_CLIENTS} WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone()
    if by_name:
        return ResolvedClient(
            crn=by_name["crn"], name=by_name["name"],
            pending=bool(by_name["crn_pending"]), findings=findings,
        )

    # ---- 3. auto-generate -------------------------------------------------------
    if cfg.crn.auto_generate:
        new_crn = generate_next_crn(cur, cfg)
        cur.execute(
            f"INSERT INTO {TABLE_CLIENTS} (crn, name, crn_pending, created_by_id, created_by_name) "
            f"VALUES (?, ?, 0, ?, ?)",
            (new_crn, name, created_by_id, created_by_name),
        )
        return ResolvedClient(crn=new_crn, name=name, created=True, findings=findings)

    # ---- 4. pending placeholder, or refuse --------------------------------------
    if pending:
        placeholder = generate_pending_crn(cur)
        cur.execute(
            f"INSERT INTO {TABLE_CLIENTS} (crn, name, crn_pending, created_by_id, created_by_name) "
            f"VALUES (?, ?, 1, ?, ?)",
            (placeholder, name, created_by_id, created_by_name),
        )
        findings.append(
            Finding(
                "client_crn", "crn_pending", Severity.WARN,
                f"'{name}' registered with placeholder {placeholder}. It shows a red 'CRN Pending' "
                f"badge on the dashboard until someone fills in the real CRN.",
            )
        )
        return ResolvedClient(crn=placeholder, name=name, created=True, pending=True, findings=findings)

    raise CrnRequiredError(
        f"'{name}' is not a registered client and CRN auto-generation is off "
        f"(app.config.ts -> crn.autoGenerate). Pass client_crn='...' with the real CRN, or "
        f"client_pending=True to register a placeholder for a human to fill in later."
    )
