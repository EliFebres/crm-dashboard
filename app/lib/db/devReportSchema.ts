/**
 * Tables for the founder's development report (see dev-report.ts), in engagements.sqlite.
 * Usage rows are keyed by tool NAME, so pasted Excel rows never need ids; a tool rename
 * cascades into them.
 *
 * Applied by index.ts's bootstrap on open, and again (idempotently) by dev-report.ts on
 * first use — a long-running process whose connection was opened before these tables
 * existed (e.g. `next dev` across a hot reload) never re-runs the bootstrap.
 */
export const DEV_REPORT_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS dev_code_months (
    month         TEXT PRIMARY KEY,
    commits       INTEGER NOT NULL DEFAULT 0,
    lines_added   INTEGER NOT NULL DEFAULT 0,
    lines_deleted INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS dev_tools (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    description           TEXT,
    status                TEXT NOT NULL DEFAULT 'live',
    launched_on           TEXT,
    minutes_saved_per_use REAL,
    users_reached         INTEGER,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_tools_name_nocase ON dev_tools (name COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS dev_tool_usage (
    day       TEXT NOT NULL,
    tool_name TEXT NOT NULL COLLATE NOCASE,
    count     INTEGER NOT NULL,
    PRIMARY KEY (day, tool_name)
  )`,
];
