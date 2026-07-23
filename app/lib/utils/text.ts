/**
 * Collapse an optional free-text identifier to a trimmed string or SQL NULL.
 *
 * Blank and whitespace-only values must land as NULL rather than '' so that
 * `LIKE` search and null-comparisons behave consistently across every write path
 * (form, bulk upload, crm_sync).
 */
export const normalizeProjectId = (raw: unknown): string | null =>
  typeof raw === 'string' && raw.trim() ? raw.trim() : null;
