export const VALID_STATUSES = ['In Progress', 'Awaiting Meeting', 'Follow Up', 'Completed'] as const;
export type EngagementStatus = typeof VALID_STATUSES[number];

// Follow Up = project delivered, NNA outcome pending. Counted as "completed"
// for dashboard metrics; the 3-month Follow Up alert in useAlerts handles the
// NNA-outcome revisit reminder.
export const COMPLETED_STATUSES: readonly EngagementStatus[] = ['Completed', 'Follow Up'];
export const OPEN_STATUSES: readonly EngagementStatus[] = ['In Progress', 'Awaiting Meeting'];

export function isCompletedStatus(s: string): boolean {
  return (COMPLETED_STATUSES as readonly string[]).includes(s);
}

export function isOpenStatus(s: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(s);
}

// SQL fragments so the "what counts as completed" rule lives in one place.
export const SQL_COMPLETED = `status IN ('Completed', 'Follow Up')`;
export const SQL_OPEN = `status IN ('In Progress', 'Awaiting Meeting')`;
