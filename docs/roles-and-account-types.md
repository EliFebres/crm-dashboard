# Roles & Account Types

This document describes every level of access in the CRM dashboard: what each user can *do* (actions) and what each user can *see* (data and UI). It reflects the system as actually enforced in code, not aspirational behavior.

Access is determined by **two independent dimensions**:

1. **Role** — `admin` or `user` (granted manually by an existing admin).
2. **Team** (account type) — `Portfolio Consulting Group`, `Equity Specialist`, `Fixed Income Specialist`, `Leadership`, or `Guest`.

Both dimensions combine. An admin on the Guest team, for example, would still have admin-only pages, but their team would still classify them as read-only on the dashboard data itself.

---

## Account Status Gate

Before role and team even come into play, every account has a status: `pending`, `active`, or `inactive`.

| Status | Can log in? | Notes |
|--------|:-----------:|-------|
| `pending` | ❌ | New signups land here. An admin must approve before the account can access anything. |
| `active` | ✅ | Normal working state. |
| `inactive` | ❌ | Deactivated by an admin. Can be reactivated. |

Status is checked at the auth layer, not at the feature layer — an inactive user cannot reach any dashboard page.

---

## Roles

### Admin (`role: 'admin'`)

Admins have **all user-level access** plus a dedicated admin section in the sidebar.

**Can do:**
- Everything a regular user on their team can do (subject to their team's read-only status, if any — see Teams below).
- Access `/admin/users` — approve pending signups, deactivate/reactivate users, promote users to admin, demote admins to user.
- Access `/admin/team-members` — add/remove team members, link/unlink user accounts, edit office assignments.
- Access `/dashboard/activity` — system-wide activity log.
- See **all teams' data** on the Client Interactions dashboard, regardless of their own team.

**Sees:**
- The full sidebar, including the admin-only section (Activity, User Management, Team Members).
- An "Admin" badge on their profile block in the sidebar footer.

**Protection:** The founder (first-created admin) can only be demoted by themselves — no other admin can strip founder privileges.

### User (`role: 'user'`)

The default role for all approved accounts.

**Cannot:**
- Access any `/admin/*` route.
- Access `/dashboard/activity`.
- Promote, approve, or manage other users.

**Sees:**
- The standard sidebar (Interactions & Trends, Competitive Landscape) — no admin section, no Admin badge.
- Data filtered by their team (see Teams below).

---

## Account Types (Teams)

Team determines **write access** and **data scope** on the dashboards. There are two groups:

- **Write-enabled teams**: PCG, Equity Specialist, Fixed Income Specialist
- **Read-only teams**: Leadership, Guest

### Portfolio Consulting Group (PCG)

| Capability | Access |
|---|---|
| Create / edit / delete interactions | ✅ |
| Bulk upload | ✅ |
| Edit status, NNA, notes | ✅ |
| Data scope | Only engagements belonging to the PCG team |

**UI:** All action buttons visible. "+ Interaction" button shown. Rows are clickable to open the edit modal.

### Equity Specialist

| Capability | Access |
|---|---|
| Create / edit / delete interactions | ✅ |
| Bulk upload | ✅ |
| Edit status, NNA, notes | ✅ |
| Data scope | Only engagements belonging to the Equity Specialist team |

**UI:** Identical to PCG. Data is filtered to their own team only.

### Fixed Income Specialist

| Capability | Access |
|---|---|
| Create / edit / delete interactions | ✅ |
| Bulk upload | ✅ |
| Edit status, NNA, notes | ✅ |
| Data scope | Only engagements belonging to the Fixed Income Specialist team |

**UI:** Identical to PCG. Data is filtered to their own team only.

### Leadership (read-only)

| Capability | Access |
|---|---|
| Create / edit / delete interactions | ❌ |
| Bulk upload | ❌ (menu item visible, but API rejects writes with HTTP 403) |
| Edit status, NNA, notes | ❌ |
| Data scope | **All teams** — can see every engagement across the organization |

**UI:**
- "+ Interaction" button is hidden.
- Clicking a row does not open the edit modal.
- Inline status and NNA controls are hidden.
- Any accidental write attempt is blocked server-side with: *"This account has read-only access and cannot modify data."*

### Guest (read-only)

| Capability | Access |
|---|---|
| Create / edit / delete interactions | ❌ |
| Bulk upload | ❌ (menu item is **hidden entirely** — stricter than Leadership) |
| Edit status, NNA, notes | ❌ |
| Data scope | **All teams** — can see every engagement across the organization |

**UI:**
- Same read-only restrictions as Leadership, plus the Bulk Upload option is removed from the menu so it's not even visible.
- All write attempts blocked server-side with HTTP 403.

---

## Data Visibility Matrix

| Account | Engagement data scope | Can modify? |
|---|---|:---:|
| Admin (any team) | All teams | Yes, unless on a read-only team |
| User · PCG | PCG engagements only | ✅ |
| User · Equity Specialist | Equity Specialist engagements only | ✅ |
| User · Fixed Income Specialist | Fixed Income Specialist engagements only | ✅ |
| User · Leadership | All teams | ❌ |
| User · Guest | All teams | ❌ |

**Additional privacy rule (applies to everyone):** the Team Member filter on the Client Interactions dashboard only exposes "All Team Members" and the current user's own name. A user cannot filter down to another team member's activity, regardless of role or team.

---

## Currently-Available Dashboards

Only the **Client Interactions** dashboard is active today. The following pages are disabled in the sidebar and labeled "In Development":

- Portfolio Trends
- Ticker Trends
- Competitive Landscape · Equity
- Competitive Landscape · Fixed Income
- Competitive Landscape · vs. Competitor

This means the role/team differences described above materialize only on the Client Interactions dashboard and the admin pages. When the other dashboards ship, they will inherit the same permission model.

---

## Where This Is Enforced (for developers)

| Concern | Location |
|---|---|
| Team and role type definitions | `app/lib/auth/types.ts` |
| Read-only team list (`READ_ONLY_TEAMS`) | `app/lib/auth/types.ts:1` |
| Client-side read-only check (`isReadOnlyUser`) | `app/lib/auth/types.ts:25` |
| Server-side write guard (`canModify`, `readOnlyError`) | `app/lib/auth/require-auth.ts:37-46` |
| Server-side data scoping (`teamConstraint`) | `app/lib/auth/require-auth.ts:48-51` |
| Admin sidebar section (role gate) | `app/components/dashboard/Sidebar.tsx` |
| Dashboard UI gating (buttons, row clicks) | `app/dashboard/interactions-and-trends/client-interactions/page.tsx` |
| User management page | `app/admin/users/page.tsx` |
| Team members management page | `app/admin/team-members/page.tsx` |

Every write API route in `app/api/client-interactions/**` calls `requireAuth` → `canModify` → `readOnlyError()` as a guard, so read-only enforcement cannot be bypassed by skipping the UI.
