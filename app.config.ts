/**
 * =============================================================================
 * Application Settings (committed, non-secret)
 * =============================================================================
 *
 * Put app-level configuration HERE — not in `.env`. `.env` is reserved for
 * secrets and machine-specific paths (SQLITE_DIR, JWT_SECRET, BACKUP_DIR) and is
 * gitignored; this file is committed so its defaults travel with the repo.
 *
 * Add future settings as new sections on the `appConfig` object below.
 * Changes take effect the next time the server starts.
 * =============================================================================
 */

export interface AppConfig {
  /** CRN (Client Reference Number) behavior. */
  crn: {
    /**
     * false → users type an existing CRN when registering a client (validated).
     * true  → the app generates the next CRN automatically (no manual entry).
     */
    autoGenerate: boolean;
    /** Prefix for generated CRNs. Used only when `autoGenerate` is true. */
    prefix: string;
    /** Zero-pad width for the generated counter, e.g. 6 → "CRN-000001". */
    pad: number;
  };
}

export const appConfig: AppConfig = {
  crn: {
    autoGenerate: false,
    prefix: 'CRN-',
    pad: 6,
  },
};
