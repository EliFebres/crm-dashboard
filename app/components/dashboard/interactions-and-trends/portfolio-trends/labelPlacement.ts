/**
 * Collision-aware placement for direct labels on a scatter-style plot.
 *
 * A cohort average and its benchmark routinely land within a few pixels of each other —
 * that closeness is the finding, not an edge case — so fixed offsets collide exactly when
 * the chart is most worth reading. This computes an offset per label instead.
 *
 * Kept apart from the component that uses it because it is pure geometry: no React, no
 * DOM, no data model. That also makes it directly testable, which matters for logic whose
 * failure mode is purely visual.
 *
 * Positions come in normalized (0..1) and the plot's pixel size comes in separately,
 * because collision is a pixel question — two dots 0.02 apart overlap in a 200px box and
 * do not in a 600px one.
 */

/** Rough advance width of a character at 10px, for estimating a label's footprint. */
export const LABEL_CHAR_W = 5.4;
/** Line box of a 10px label. */
export const LABEL_H = 12;
/** Minimum clear space between two stacked labels. */
export const LABEL_GAP = 4;
/** Distance from a dot's centre to the near edge of its own label. */
export const DOT_CLEARANCE = 15;

export interface LabelInput {
  key: string;
  /** Used only to estimate width. */
  label: string;
  /** Normalized 0..1, left to right. */
  x: number;
  /** Normalized 0..1, top to bottom. */
  y: number;
}

interface Placed extends LabelInput {
  px: number;
  py: number;
  halfW: number;
  dir: -1 | 1;
  ly: number;
}

/** True when two labels are close enough horizontally to collide if drawn at one height. */
function overlapsX(a: Placed, b: Placed): boolean {
  return Math.abs(a.px - b.px) < a.halfW + b.halfW + 4;
}

/**
 * Vertical offset for each label, keyed by input key, in pixels from its dot's centre.
 *
 * Three passes:
 *
 *  1. **Pick a side.** A dot compares its height against the mean of the dots it could
 *     collide with horizontally. Above that mean puts its label above, below puts it
 *     below — so in the common two-dot case the upper label goes up and the lower one
 *     goes down, opening a gap rather than stacking into one. A dot with no horizontal
 *     neighbour has nothing to avoid and defaults to above.
 *  2. **Stack within a side.** Labels still overlapping a same-side neighbour are pushed
 *     further out, walking away from the dots, so the nearest label keeps the shortest
 *     leader and later ones step over it.
 *  3. **Keep them in frame.** A label past an edge flips to the other side of its dot
 *     rather than being clipped, and clamps only if that fails too.
 *
 * With no measurement yet (`w`/`h` zero, before first layout) it falls back to a fixed
 * fan so the first paint is never label-less.
 */
export function placeLabels(labels: LabelInput[], w: number, h: number): Map<string, number> {
  const out = new Map<string, number>();
  if (labels.length === 0) return out;
  if (w <= 0 || h <= 0) {
    labels.forEach((l, i) => out.set(l.key, -DOT_CLEARANCE - i * (LABEL_H + LABEL_GAP)));
    return out;
  }

  const pts: Placed[] = labels.map((l) => ({
    ...l,
    px: l.x * w,
    py: l.y * h,
    halfW: (l.label.length * LABEL_CHAR_W) / 2,
    dir: -1,
    ly: 0,
  }));

  // 1. Side per dot.
  for (const p of pts) {
    const near = pts.filter(
      (q) => q.key !== p.key && overlapsX(p, q) && Math.abs(q.py - p.py) < LABEL_H * 3
    );
    if (near.length === 0) {
      p.dir = -1;
    } else {
      const meanY = (p.py + near.reduce((sum, q) => sum + q.py, 0)) / (near.length + 1);
      p.dir = p.py <= meanY ? -1 : 1;
    }
    p.ly = p.py + p.dir * DOT_CLEARANCE;
  }

  // 2. Stack same-side neighbours, walking outward from the dots.
  for (const dir of [-1, 1] as const) {
    const group = pts.filter((p) => p.dir === dir);
    group.sort((a, b) => (dir === -1 ? b.ly - a.ly : a.ly - b.ly));
    for (let i = 1; i < group.length; i++) {
      for (let j = 0; j < i; j++) {
        if (!overlapsX(group[i], group[j])) continue;
        const gap = LABEL_H + LABEL_GAP;
        if (dir === -1) group[i].ly = Math.min(group[i].ly, group[j].ly - gap);
        else group[i].ly = Math.max(group[i].ly, group[j].ly + gap);
      }
    }
  }

  // 3. Keep inside the frame: flip first, clamp only as a last resort.
  const top = LABEL_H / 2;
  const bottom = h - LABEL_H / 2;
  for (const p of pts) {
    if (p.ly < top) p.ly = p.py + DOT_CLEARANCE;
    else if (p.ly > bottom) p.ly = p.py - DOT_CLEARANCE;
    p.ly = Math.max(top, Math.min(bottom, p.ly));
    out.set(p.key, p.ly - p.py);
  }
  return out;
}
