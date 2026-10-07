/**
 * Converts a date string to ISO date ("2025-01-15" or null).
 * Accepts YYYY-MM-DD (from <input type="date">) or display format ("Jan 15, 2025").
 * Used when writing to SQLite.
 */
export function toISODate(dateStr: string | null | undefined): string | null {
  if (!dateStr || dateStr === '—') return null;
  // Already ISO format — return directly to avoid UTC timezone shift.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Display format fallback — parse as local midnight to avoid UTC shift.
  const d = new Date(dateStr + ' 00:00:00');
  if (isNaN(d.getTime())) return null;
  return localDateISO(d);
}

/**
 * Returns today's date as a local YYYY-MM-DD string (no UTC shift).
 */
export function localTodayISO(): string {
  return localDateISO(new Date());
}

/** Formats a Date as YYYY-MM-DD using local time. */
function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Converts an ISO date string ("2025-01-15") from SQLite to display format ("Jan 15, 2025").
 * Returns "—" for null/undefined (used for in-progress engagements with no finish date).
 */
export function toDisplayDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  // Force local midnight parse to avoid UTC offset shifting the date
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The same calendar day `n` months before `from`, clamped to the target month's
 * last day. `new Date(y, m - n, d)` overflows on the 29th–31st (Mar 31 − 1M →
 * "Feb 31" → Mar 3), which would silently shorten the period window.
 */
function monthsAgo(from: Date, n: number): Date {
  const target = new Date(from.getFullYear(), from.getMonth() - n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(from.getDate(), lastDay));
  return target;
}

/**
 * Returns the ISO date string marking the start of the given period filter.
 * Returns null for "ALL" (no date constraint).
 */
export function getPeriodStartISO(period: string): string | null {
  const now = new Date();
  switch (period) {
    case '1W':
      return localDateISO(new Date(now.getTime() - 7 * 86400000));
    case '1M':
      return localDateISO(monthsAgo(now, 1));
    case '3M':
      return localDateISO(monthsAgo(now, 3));
    case '6M':
      return localDateISO(monthsAgo(now, 6));
    case 'YTD':
      return localDateISO(new Date(now.getFullYear(), 0, 1));
    case '1Y':
      return localDateISO(monthsAgo(now, 12));
    case 'ALL':
      return null;
    default:
      return localDateISO(monthsAgo(now, 12));
  }
}

/**
 * Weekday-grid window for the "Completed Interactions" heatmap. Spans the active
 * period filter (via {@link getPeriodStartISO}) up to today, so the heatmap
 * tracks whatever range the rest of the dashboard is showing. For ALL (no period
 * start) it falls back to `earliestISO` (the earliest completion in the data) so
 * the whole history shows, or ~1 year if there's nothing to anchor on.
 *
 * Returns the Monday the grid should start on and how many weeks it spans to
 * include today.
 */
export function getContributionWindow(
  period: string,
  earliestISO?: string | null,
): { anchorMonday: Date; weekCount: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let startISO = getPeriodStartISO(period);
  if (!startISO) {
    startISO = earliestISO || localDateISO(monthsAgo(today, 12));
  }

  const start = new Date(startISO + 'T00:00:00');
  // Align to the Monday of the start week (Mon–Fri → that week; weekend → next).
  const dayOfWeek = start.getDay();
  const mondayOffset = dayOfWeek === 0 ? 1 : dayOfWeek === 6 ? 2 : 1 - dayOfWeek;
  const anchorMonday = new Date(start);
  anchorMonday.setDate(start.getDate() + mondayOffset);
  anchorMonday.setHours(0, 0, 0, 0);

  const msPerWeek = 7 * 86400000;
  const weekCount = Math.max(1, Math.floor((today.getTime() - anchorMonday.getTime()) / msPerWeek) + 1);
  return { anchorMonday, weekCount };
}

/**
 * Returns ISO start/end dates for the previous equivalent period (used for change% calculations).
 */
export function getPreviousPeriodDates(period: string): { start: string; end: string; label: string } {
  const now = new Date();
  switch (period) {
    case '1W': {
      const currStart = new Date(now.getTime() - 7 * 86400000);
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = new Date(prevEnd.getTime() - 7 * 86400000);
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev week',
      };
    }
    case '1M': {
      const currStart = monthsAgo(now, 1);
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = monthsAgo(now, 2);
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev month',
      };
    }
    case '3M': {
      const currStart = monthsAgo(now, 3);
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = monthsAgo(now, 6);
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev 3M',
      };
    }
    case '6M': {
      const currStart = monthsAgo(now, 6);
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = monthsAgo(now, 12);
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev 6M',
      };
    }
    case 'YTD': {
      const prevEnd = monthsAgo(now, 12);
      const prevStart = new Date(now.getFullYear() - 1, 0, 1);
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev YTD',
      };
    }
    case 'ALL':
      return { start: '2000-01-01', end: '2099-12-31', label: 'All Time' };
    case '1Y':
    default: {
      const currStart = monthsAgo(now, 12);
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = monthsAgo(now, 24);
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'YoY',
      };
    }
  }
}
