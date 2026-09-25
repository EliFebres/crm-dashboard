/**
 * Light-theme tokens for the KPI report PDF. Same editorial language as the on-screen
 * briefing (briefing/tokens.ts): hairline rules, mono eyebrows, cyan/green accents,
 * no cards. Accents are darkened where they carry text, so they stay readable on white;
 * the bright originals are kept for fills.
 */
export const P = {
  page: '#ffffff',
  ink: '#0a0a0f',
  strong: '#09090b',
  muted: '#3f3f46',
  faint: '#52525b',
  hairline: '#e4e4e7',
  axis: '#d4d4d8',
  track: '#f4f4f5',
  cyan: '#155e75',
  cyanFill: '#22d3ee',
  green: '#15803d',
  greenFill: '#10b981',
  red: '#dc2626',
} as const;

/** react-pdf's built-in fonts, so the PDF needs no font downloads. */
export const SANS_FONT = 'Helvetica';
export const SANS_BOLD = 'Helvetica-Bold';
export const MONO_FONT = 'Courier';
