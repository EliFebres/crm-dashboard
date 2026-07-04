<div align="center">

![CRM Dashboard](docs/assets/crm-dashboard-banner.png)

# A Real-Time CRM & Insights Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![Recharts](https://img.shields.io/badge/Recharts-3-22B5BF?logo=chartdotjs&logoColor=white)](https://recharts.org/)

</div>

> [!NOTE]
> 📹 A full video walkthrough of the app is coming soon, along with a detailed doc explaining how it works.

---

## Overview

A Next.js CRM and insights dashboard for logging, tracking, and analyzing client engagements across teams. The **Client Interactions** dashboard is fully live, backed by SQLite (better-sqlite3) with real-time cross-user updates. The Portfolio Trends, Ticker Trends, and Competitive Landscape sections are scaffolded and disabled in the sidebar pending a future re-enable.

**Key Capabilities:**

- **Full engagement tracking** — create, edit, and delete client interactions (IRQ, SERF, Ad-Hoc) with inline edits for status, NNA, and notes
- **Real-time collaboration** — Server-Sent Events push other users' changes into open dashboards instantly, with Bloomberg-style flash animations on every change
- **Rich-text notes** — per-note author attribution; only the author can edit or delete their own notes
- **Bulk import** — onboard existing engagements from Excel (.xlsx) or CSV with in-browser preview and validation
- **Insights at a glance** — contribution heatmap, department breakdown, and metric cards with period-over-period change
- **Role-based access** — admin approval workflow and team-scoped edit permissions

## Use Cases

- **Client interaction tracking** — Keep a complete, searchable history of every engagement, note, and NNA figure in one place.
- **Team activity monitoring** — See who's doing what over any time period via the contribution heatmap, department chart, and metric cards.
- **Real-time teamwork** — Multiple users work the same dashboard and see each other's edits live, with no page refresh.
- **Migrating existing records** — Bulk-import engagements from spreadsheets, with validation before anything is committed.

## Getting Started

**Prerequisites:**
- [Node.js](https://nodejs.org/) 20+ and npm

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

Open [http://localhost:3000](http://localhost:3000) and sign up.

> [!TIP]
> The **first account** created is automatically granted admin status. Every account after that starts as **pending** and must be approved by an admin before it can log in.

## Features

### Authentication & Access
- Email/password login and signup (scrypt-hashed via Node.js crypto)
- JWT session cookies (30-day expiration, httpOnly, sameSite: lax)
- Admin approval workflow — pending users are gated until approved
- Team-scoped permissions — users can only edit engagements for their team (admins can edit all)

### Client Interactions Dashboard
- Full CRUD for engagements via modal forms, with optimistic locking on saves
- Inline single-field edits for status, NNA (Net New Assets), and notes
- Real-time cross-user updates over Server-Sent Events, with pulse-flash animations for added/removed rows, changed cells, and metric deltas
- Rich-text notes (TipTap) with per-author edit/delete control
- Bulk upload from Excel/CSV with a downloadable template and pre-commit validation
- GitHub-style contribution heatmap, department breakdown chart, and metric cards
- Filterable, sortable, paginated table with fullscreen view, text search, and CSV export

### Admin
- **`/admin/users`** — approve pending users, deactivate accounts, promote/demote admins
- **`/admin/team-members`** — manage the team member directory used throughout the dashboard

> [!NOTE]
> The **Portfolio Trends**, **Ticker Trends**, and **Competitive Landscape** sections are scaffolded but greyed out in the sidebar. Their page code exists under `app/dashboard/`, pending a future re-enable.

## Configuration

### Environment Variables

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

> [!NOTE]
> When `SQLITE_DIR` is set, the app reads from and writes to real SQLite databases. If it is unset, the app falls back to in-memory mock data (read-only).

### App settings (`app.config.ts`)

Non-secret, app-level settings live in **`app.config.ts`** at the repo root (committed — not in `.env`). Every external client is identified by a unique **CRN**. Under `appConfig.crn`:

- `autoGenerate: false` (default) — users enter an existing CRN from your source system when registering a client.
- `autoGenerate: true` — the app assigns CRNs automatically, formatted as `prefix` + a zero-padded counter, e.g. `CRN-000001`.

Edit the file and restart the server to apply changes.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server at localhost:3000 |
| `npm run build` | Build for production |
| `npm start` | Start the production server |
| `npm run lint` | Run ESLint |
| `npm run seed` | Create the SQLite schema only (no data) |
| `npm run seed:mock` | Create the schema and populate ~500 mock engagements |
| `npm run db:backup` | Back up all databases to a timestamped folder in `BACKUP_DIR` |
| `npm run db:restore` | Restore databases from a backup (`-- --help` for options) |

> [!WARNING]
> **Stop the app server before running `db:restore`** so no open connection holds a WAL file over the database being replaced.

## Acknowledgements

Built on the work of great open-source projects, including [Next.js](https://nextjs.org/), [React](https://react.dev/), [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [Recharts](https://recharts.org/), [TipTap](https://tiptap.dev/), [Radix UI](https://www.radix-ui.com/), [ExcelJS](https://github.com/exceljs/exceljs), [jose](https://github.com/panva/jose), [Tailwind CSS](https://tailwindcss.com/), and [Lucide](https://lucide.dev/). Thanks to their maintainers!

## License

Released under the [MIT License](LICENSE).
