/**
 * Design tokens for the "Briefing" Team KPIs redesign. Values are lifted directly
 * from the handoff's Design Tokens table so the editorial look (near-black canvas,
 * light-weight display text, monospace numerics, hairline rules, no cards) is exact.
 */
import type { CSSProperties } from 'react';

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

export const C = {
  bg: '#050508',
  textPrimary: '#ffffff',
  textStrong: '#e4e4e7',
  textSecondary: '#a5a5b2',
  textMuted: '#71717a',
  textFaint: '#52525b',
  axis: '#a1a1aa',
  ghost: 'rgba(255,255,255,0.28)',
  dividerGroup: 'rgba(39,39,42,0.7)',
  dividerRow: 'rgba(39,39,42,0.45)',
  cyan: '#22d3ee',
  green: '#39FF14',
  red: '#FF3131',
  completed: '#10b981',
  dataTask: '#f97316',
  paretoRef: '#f59e0b',
  gridline: '#1c1c22',
  paretoGrid: '#27272a',
  returning: '#3f3f46',
  amber: '#fbbf24',
  violet: '#a78bfa',
} as const;

/** Mono cyan "Q#" label above each question. */
export const qLabelStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 11,
  color: C.cyan,
  marginBottom: 10,
};

/** The 25px / weight-300 question headline. */
export const questionStyle: CSSProperties = {
  fontSize: 25,
  fontWeight: 300,
  color: C.textPrimary,
  letterSpacing: '-0.01em',
  lineHeight: 1.3,
};

/** The 13px secondary verdict sentence. */
export const verdictStyle: CSSProperties = {
  fontSize: 13,
  color: C.textSecondary,
  marginTop: 12,
  lineHeight: 1.5,
};

/** Small mono caption used above charts (e.g. legends). */
export const captionStyle: CSSProperties = {
  fontSize: 11,
  color: C.textMuted,
  marginBottom: 10,
  fontFamily: MONO,
};
