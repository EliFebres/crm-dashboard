# CRM Dashboard

A Next.js CRM and insights dashboard application. The **Client Interactions** dashboard is fully live, backed by SQLite (better-sqlite3) with real-time cross-user updates. The Portfolio Trends, Ticker Trends, and Competitive Landscape sections are scaffolded and disabled in the sidebar pending a future re-enable.

## Features

### Authentication
- Login/signup with email and password (scrypt-hashed via Node.js crypto)
- JWT session cookies (24-hour expiration, httpOnly, sameSite: lax)
- First registered user is automatically granted admin status
- Subsequent users start as **pending** and must be approved by an admin before they can log in

### Admin Dashboard
- **`/admin/users`** — View all registered users with their team, office, and status; approve pending users, deactivate active users, promote/demote admin role
- **`/admin/team-members`** — Manage the team member directory used throughout the dashboard (name, team, office, status; link to user account)

### Client Interactions Dashboard
- Track and manage client engagements (IRQ, SERF, Ad-Hoc) with full CRUD support
- Create, edit, and delete engagements via modal forms
- **Bulk upload** — import engagements from Excel (.xlsx) or CSV; downloadable XLSX template; in-browser preview and validation before committing
- **Real-time cross-user updates** — Server-Sent Events stream (`/api/client-interactions/events`) pushes mutations from other users into open dashboards immediately, with no page refresh
- **Bloomberg-style flash animations** — `useDashboardChanges` diffs each incoming snapshot and pulse-flashes added rows, removed rows (ghost-row fade), changed cells, metric deltas, contribution-graph cells, and department counts (neutral / blue / green / red / amber) for ~1.1s
- Inline edits for status, NNA (Net New Assets), and notes (each backed by a dedicated single-field endpoint with optimistic locking)
- **Rich text notes** — TipTap-powered editor with per-note author attribution; only the original author can edit or delete their own note
- GitHub-style contribution heatmap showing daily activity over time
- Department breakdown bar chart
- Metric cards: Client Projects, Ad-Hoc, In Progress, and NNA — all with period-over-period change
- Filterable, sortable, paginated table with expandable rows
- Fullscreen table view
- Filters: Team Member, Department, Intake Type, Project Type, Time Period, Status
- Text search across clients, intake type, and project type
- CSV export of the currently-filtered view

### Portfolio Trends Dashboard *(shelved — disabled in sidebar)*
- Portfolio construction insights and client analytics
- Style Map and Profitability Map visualizations
- Benchmark comparison vs MSCI ACWI IMI
- Equity and Fixed Income metrics
- Logged Portfolios table with expandable position details and fullscreen view

The page code still exists under `app/dashboard/interactions-and-trends/portfolio-trends/`, but the nav item is greyed out pending a future re-enable.

### Ticker Trends Dashboard *(shelved — disabled in sidebar)*
- Hot Tickers & Firm Competitors comparison table with inline editing (type, notes, talking points, PCR links)
- Most Popular Firm Tickers ranking
- Ticker Adoption Trend chart over time

The page code still exists under `app/dashboard/interactions-and-trends/ticker-trends/`, but the nav item is greyed out.

### Competitive Landscape *(scaffolded — all three pages disabled in sidebar)*
- **Equity** — competitor equity fund comparison table with inline notes
- **Fixed Income** — same pattern for fixed-income funds
- **vs. Competitor** — head-to-head firm vs. competitor comparison split by category

All three nav items are currently greyed out. UI components (`CompetitorTable`, `CompetitorVsFirmTable`, `CompetitiveNotesModal`) live under `app/components/dashboard/competitive-landscape/`, but data is mocked and the section is not yet wired up to the database.

## Tech Stack

- **Next.js 16.2.1** with App Router and Server-Sent Events
- **React 19.2.3** with TypeScript
- **Tailwind CSS 4** for styling
- **SQLite** via **better-sqlite3 12** (embedded, WAL mode) for data persistence
- **Jose 6.2.2** for JWT authentication
- **Recharts 3.7.0** for data visualization
- **TipTap 3.21** for rich text note editing
- **ExcelJS 4.4** for Excel bulk upload parsing
- **DomPurify 3.3** for rich text HTML sanitization
- **Lucide React** for icons

## Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
# Absolute path to the folder where the SQLite database files will be stored.
# Keep this on LOCAL disk (not a network share) for reliability.
SQLITE_DIR=./data

# 32+ character hex string used to sign JWT session tokens
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your_jwt_secret_here

# Absolute path where database backups will be stored (used by db:backup / db:restore)
BACKUP_DIR=/path/to/backups
```

When `SQLITE_DIR` is set, the app reads from and writes to real SQLite databases. If it is unset, the app falls back to in-memory mock data (read-only).

### App settings (`app.config.ts`)

Non-secret, app-level settings live in **`app.config.ts`** at the repo root (committed — not in `.env`). Edit that file and restart the server to apply changes.

Every external client is identified by a unique **CRN**. Under `appConfig.crn`:

- `autoGenerate: false` (default) — users enter an existing CRN from your source system when registering a client.
- `autoGenerate: true` — the app assigns CRNs automatically, formatted as `prefix` + a zero-padded counter (`pad` width), e.g. `CRN-000001`.

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env  # then edit .env with your values

# Initialize the database and populate with mock data
npm run seed:mock

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign up — the first account created is automatically an admin.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server at localhost:3000 |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run seed` | Create SQLite schema only (no data) |
| `npm run seed:mock` | Create schema and populate with ~500 mock engagements |
| `npm run db:backup` | Back up all databases to a timestamped folder in `BACKUP_DIR` |
| `npm run db:restore` | Restore databases from the most recent backup (see options below) |

### Restore options

```bash
npm run db:restore                                    # most recent backup, both DBs
npm run db:restore -- --backup 2026-03-27_02-00-00   # specific backup
npm run db:restore -- --db engagements               # engagements DB only
npm run db:restore -- --db users                     # users DB only
npm run db:restore -- --yes                          # skip confirmation prompt
```

**Stop the app server before restoring** so no connection holds a WAL over the file being replaced.

### Automated weekly backups (Windows Task Scheduler)

1. Open **Task Scheduler** → *Create Basic Task*
2. Trigger: **Weekly**, Sunday at **2:00 AM**
3. Action: Start a program
   - Program: `cmd.exe`
   - Arguments: `/c "cd /d D:\path\to\crm-dashboard && npm run db:backup >> D:\path\to\backups\backup.log 2>&1"`

The 8 most recent backups are kept automatically (~2 months of history).

## Project Structure

```
app/
├── page.tsx                            # Public landing page
├── layout.tsx                          # Root layout (Geist Sans/Mono + Inter fonts)
├── globals.css                         # Theme, animations, pulse-flash keyframes
├── api/                                # Next.js route handlers (server-side)
│   ├── auth/                           # login, signup, logout, me
│   ├── admin/
│   │   ├── users/                      # List, update, plus SSE events for user admin
│   │   └── team-members/               # Team member directory CRUD
│   ├── team-members/                   # Public team member directory endpoint
│   └── client-interactions/
│       ├── dashboard/                  # Batched initial-load aggregation
│       ├── metrics/                    # Metric cards
│       ├── departments/                # Department breakdown
│       ├── contribution-data/          # Heatmap
│       ├── internal-clients/                # Client autocomplete source
│       ├── events/                     # SSE: cross-user real-time updates
│       ├── export/                     # Filtered CSV export
│       └── engagements/
│           ├── route.ts                # List, create
│           ├── bulk/                   # Bulk upload ingest
│           ├── template/               # Engagements XLSX template
│           ├── portfolio-template/     # Portfolio XLSX template
│           └── [id]/
│               ├── route.ts            # PATCH (with version check), DELETE
│               ├── status/             # Single-field status update
│               ├── nna/                # Single-field NNA update
│               └── notes/              # Append, edit, delete notes (author-only)
├── admin/
│   ├── users/                          # Admin user management page
│   └── team-members/                   # Admin team member directory page
├── login/                              # Login page
├── signup/                             # Registration / access request page
├── dashboard/
│   ├── layout.tsx                      # AppShell wrapper
│   ├── interactions-and-trends/
│   │   ├── page.tsx                    # Redirect → client-interactions
│   │   ├── client-interactions/        # ACTIVE — engagement tracking
│   │   ├── portfolio-trends/           # DISABLED in sidebar
│   │   └── ticker-trends/              # DISABLED in sidebar
│   └── competitive-landscape/
│       ├── page.tsx                    # Redirect → equity
│       ├── equity/                     # DISABLED in sidebar
│       ├── fixed-income/               # DISABLED in sidebar
│       └── vs-competitor/              # DISABLED in sidebar
├── components/
│   ├── AppShell.tsx                    # Auth provider + sidebar + radial glow background
│   ├── auth/                           # LoginModal, SignupModal
│   ├── landing-page/                   # Hero, DashboardPreview, FeatureSections, PlatformRoadmap
│   ├── ui/
│   │   ├── Select.tsx                  # Radix Select wrapper with glass styling
│   │   └── Popover.tsx                 # Radix Popover wrapper with glass styling
│   └── dashboard/
│       ├── Sidebar.tsx                 # Collapsible nav, admin section visible to admins only
│       ├── shared/
│       │   ├── DashboardHeader.tsx     # Reusable header with filters and period selector
│       │   └── ClientOnlyChart.tsx     # SSR-safe chart wrapper for Recharts
│       ├── interactions-and-trends/
│       │   ├── client-interactions/    # MetricCards, ContributionGraph, DepartmentChart,
│       │   │                           # InteractionsTable, NewInteractionForm, BulkUploadModal,
│       │   │                           # NNAModal, NotesModal, PortfolioModal
│       │   └── ticker-trends/          # HotTickersTable, SimpleNotesModal, LinkModal, charts
│       └── competitive-landscape/
│           ├── CompetitorTable.tsx
│           ├── CompetitorVsFirmTable.tsx
│           └── CompetitiveNotesModal.tsx
└── lib/
    ├── api/                            # Client-side fetch wrappers (+ docs/)
    ├── auth/                           # JWT, scrypt password utils, AuthContext, require-auth
    ├── bulk-upload/                    # Excel/CSV parser and row validator
    ├── data/                           # Mock data generators (engagements is seed-only)
    ├── db/                             # SQLite connection, queries, aggregations, dateUtils
    ├── hooks/                          # useDashboardChanges (flash-animation diffing)
    ├── types/                          # TypeScript interfaces per domain
    └── utils/
scripts/
├── seed-db.ts                          # Schema creation and optional mock data seeding
├── backup-db.ts                        # Timestamped database backup (keeps 8)
└── restore-db.ts                       # Restore from a backup folder
```

Auth is enforced per-route via `app/lib/auth/require-auth.ts` — there is no top-level `middleware.ts`.

## Design

- Dark theme with zinc/black palette
- Blue/cyan accent gradients
- Glassmorphism UI with backdrop blur effects
- Responsive layout with collapsible sidebar navigation
- Bloomberg-style real-time pulse-flash animations (neutral / blue / green / red / amber) on row, cell, and metric changes — driven by `useDashboardChanges` and the `pulseFlash*` keyframes in `app/globals.css`
