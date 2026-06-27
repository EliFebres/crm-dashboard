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
 * Returns the ISO date string marking the start of the given period filter.
 * Returns null for "ALL" (no date constraint).
 */
export function getPeriodStartISO(period: string): string | null {
  const now = new Date();
  switch (period) {
    case '1W':
      return localDateISO(new Date(now.getTime() - 7 * 86400000));
    case '1M':
      return localDateISO(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()));
    case '3M':
      return localDateISO(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()));
    case '6M':
      return localDateISO(new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()));
    case 'YTD':
      return localDateISO(new Date(now.getFullYear(), 0, 1));
    case '1Y':
      return localDateISO(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
    case 'ALL':
      return null;
    default:
      return localDateISO(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()));
  }
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
      const currStart = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 2, now.getDate());
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev month',
      };
    }
    case '3M': {
      const currStart = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev 3M',
      };
    }
    case '6M': {
      const currStart = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'vs prev 6M',
      };
    }
    case 'YTD': {
      const prevEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
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
      const currStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      const prevEnd = new Date(currStart.getTime() - 86400000);
      const prevStart = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
      return {
        start: localDateISO(prevStart),
        end: localDateISO(prevEnd),
        label: 'YoY',
      };
    }
  }
}
