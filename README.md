<div align="center">

![CRM Dashboard](docs/assets/crm-dashboard-banner.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white)](https://github.com/WiseLibs/better-sqlite3)
[![Recharts](https://img.shields.io/badge/Recharts-3-22B5BF?logo=chartdotjs&logoColor=white)](https://recharts.org/)

</div>

A Next.js CRM and insights dashboard application. The **Client Interactions** dashboard is fully live, backed by SQLite (better-sqlite3) with real-time cross-user updates. The Portfolio Trends, Ticker Trends, and Competitive Landscape sections are scaffolded and disabled in the sidebar pending a future re-enable.

> 📹 **Walkthrough:** A full video walkthrough of the app is coming soon. A more detailed doc explaining how it works will follow.

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
