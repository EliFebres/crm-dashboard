/**
 * Chart tokens for Portfolio Trends — the palette, and the rules for spending it.
 *
 * Color here does exactly one job: **identity**. A hue means "this cohort", never "this
 * value" and never "this rank". Two consequences that are easy to get wrong:
 *
 *  - `cohortColor` keys off a cohort's position in the *full* option list, not its
 *    position in the current selection. Deselecting a cohort must not repaint the
 *    survivors — a reader who learned "60/40 Model is blue" would be misled.
 *  - The benchmark is deliberately outside the palette. It is not a cohort competing for
 *    identity, it is the reference every cohort is measured against, so it wears neutral
 *    gray in every chart.
 *
 * The eight hues and their order are the documented default categorical palette, stepped
 * for a dark surface. The order is the colorblind-safety mechanism, not a mood board:
 * validated against this app's actual card surface (#131316, which is what zinc-900/60
 * composites to over the #0a0a0a page) at
 *
 *   adjacent pairs — worst CVD ΔE 8.4, worst normal-vision ΔE 19.3, all slots ≥ 3:1
 *   all pairs, first 3 slots — worst CVD ΔE 9.4, worst normal-vision ΔE 20.9
 *
 * Adjacent-pair validation is what bar and line charts need (only neighbours touch).
 * Scatter needs all-pairs, because any two dots can land side by side — and no ordering
 * of eight colors clears all-pairs. Hence SCATTER_COHORT_LIMIT: past three cohorts a
 * scatter folds the rest away rather than inventing a fourth distinguishable hue.
 *
 * Re-validate with the skill's script if any hex here changes:
 *   node scripts/validate_palette.js "<hexes>" --mode dark --surface "#131316" [--pairs all]
 */

/** Categorical slots, in the fixed order that passes the CVD gates. Never reordered, never cycled. */
export const SERIES_PALETTE = [
  { hex: '#3987e5', glow: 'rgba(57,135,229,0.40)' },   // 1 blue
  { hex: '#d95926', glow: 'rgba(217,89,38,0.40)' },    // 2 orange
  { hex: '#199e70', glow: 'rgba(25,158,112,0.40)' },   // 3 aqua
  { hex: '#c98500', glow: 'rgba(201,133,0,0.40)' },    // 4 yellow
  { hex: '#d55181', glow: 'rgba(213,81,129,0.40)' },   // 5 magenta
  { hex: '#008300', glow: 'rgba(0,131,0,0.40)' },      // 6 green
  { hex: '#9085e9', glow: 'rgba(144,133,233,0.40)' },  // 7 violet
  { hex: '#e66767', glow: 'rgba(230,103,103,0.40)' },  // 8 red
] as const;

/**
 * How many cohorts a scatter can carry. Three is not a layout preference — it is where
 * the all-pairs colorblind check stops passing. The fourth slot puts yellow beside
 * orange, which collapses under deuteranopia when both can be adjacent on the plot.
 */
export const SCATTER_COHORT_LIMIT = 3;

/** The reference series. Neutral by design — see the module comment. */
export const BENCHMARK_COLOR = { hex: '#a1a1aa', glow: 'rgba(161,161,170,0.30)' } as const;

/** Individual models behind a cohort average: a cloud, not a series. No identity to carry. */
export const MODEL_CLOUD_COLOR = 'rgba(161,161,170,0.28)';

/** Chart chrome. One shade off the surface, solid hairlines — never dashed. */
export const CHART_INK = {
  grid: 'rgba(255,255,255,0.07)',
  axis: 'rgba(82,82,91,0.6)',
  tick: '#a5a5b2',
  muted: '#71717a',
  primary: '#e4e4e7',
} as const;

/** Delta cues. Paired with a +/- sign everywhere they are used, never color alone. */
export const DELTA_INK = { up: '#34d399', down: '#f87171', flat: '#a1a1aa' } as const;

/**
 * Single-hue ordinal ramp (blue, light → dark) for the style-box heatmap, where color
 * encodes magnitude rather than identity. Stops short of the darkest steps so the low
 * end still separates from the card surface.
 */
export const SEQUENTIAL_BLUE = [
  '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95',
] as const;

/**
 * Stable color for a cohort.
 *
 * `allCohorts` is the full option list, sorted so the mapping does not move when the
 * selection changes or when the underlying counts shift. A cohort not in the list falls
 * back to slot 1 rather than throwing — an unknown series should still draw.
 */
export function cohortColor(cohort: string, allCohorts: readonly string[]) {
  const idx = allCohorts.indexOf(cohort);
  return SERIES_PALETTE[(idx < 0 ? 0 : idx) % SERIES_PALETTE.length];
}

/** Index into SERIES_PALETTE for a cohort — for components that take an index, not a color. */
export function cohortSlot(cohort: string, allCohorts: readonly string[]): number {
  const idx = allCohorts.indexOf(cohort);
  return (idx < 0 ? 0 : idx) % SERIES_PALETTE.length;
}

/** Sort helper: the stable order `cohortColor` keys off. */
export function stableCohortOrder(cohorts: readonly string[]): string[] {
  return [...cohorts].sort((a, b) => a.localeCompare(b));
}

/** Position on the sequential ramp for a 0..1 magnitude. */
export function sequentialStep(value: number, max: number): string {
  if (!Number.isFinite(value) || max <= 0) return SEQUENTIAL_BLUE[0];
  const t = Math.min(1, Math.max(0, value / max));
  return SEQUENTIAL_BLUE[Math.min(SEQUENTIAL_BLUE.length - 1, Math.round(t * (SEQUENTIAL_BLUE.length - 1)))];
}
