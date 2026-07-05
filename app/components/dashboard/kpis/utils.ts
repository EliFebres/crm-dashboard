/**
 * Shared formatting and color helpers for the KPI dashboard.
 * Colors align with BADGE_COLORS in InteractionsTable for visual consistency.
 */

export const KPI_COLORS = {
  blue: '#3b82f6',
  cyan: '#22d3ee',
  cyanLight: '#a5f3fc',
  cyanDark: '#0e7490',
  emerald: '#10b981',
  amber: '#f59e0b',
  orange: '#f97316',
  violet: '#8b5cf6',
  rose: '#f43f5e',
  pink: '#ec4899',
  zinc: '#71717a',
  green: '#39FF14',
  red: '#FF3131',
} as const;

export const PROJECT_TYPE_COLOR: Record<string, string> = {
  'Discovery Meeting': KPI_COLORS.cyan,
  'Meeting': KPI_COLORS.violet,
  'Follow-up Meeting': KPI_COLORS.emerald,
  'Follow-up Material': KPI_COLORS.amber,
  'Data Request': KPI_COLORS.cyanLight,
  'Data Update': KPI_COLORS.orange,
  'PCR': KPI_COLORS.rose,
  'Other': KPI_COLORS.zinc,
};

export const INTAKE_COLOR: Record<string, string> = {
  'IRQ': KPI_COLORS.blue,
  'SERF': KPI_COLORS.emerald,
  'Ad-Hoc': KPI_COLORS.pink,
};

export const OUTCOME_COLOR: Record<string, string> = {
  'Completed w/ NNA': KPI_COLORS.emerald,
  'Completed no NNA': KPI_COLORS.cyanLight,
  'Still Open': KPI_COLORS.blue,
  'Stalled': KPI_COLORS.orange,
};

export function formatCurrency(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function formatDelta(pct: number): string {
  if (pct === 0) return '—';
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

export function deltaClass(pct: number, invert = false): string {
  if (pct === 0) return 'text-muted';
  const positive = invert ? pct < 0 : pct > 0;
  return positive ? 'text-[#39FF14]' : 'text-[#FF3131]';
}

export function nodeColor(node: { name: string; kind: 'intake' | 'project' | 'outcome'; color?: string }): string {
  // Prefer the managed color from the intake/project-type registry; fall back to the
  // static maps (kept in sync with the seed) so a renamed type still colors sensibly.
  if (node.color) return node.color;
  if (node.kind === 'intake') return INTAKE_COLOR[node.name] ?? KPI_COLORS.zinc;
  if (node.kind === 'project') return PROJECT_TYPE_COLOR[node.name] ?? KPI_COLORS.zinc;
  return OUTCOME_COLOR[node.name] ?? KPI_COLORS.zinc;
}
