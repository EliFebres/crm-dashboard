'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BENCHMARK_COLOR, CHART_INK } from './chartTokens';

/**
 * Grouped bars: one group per bucket, one bar per cohort, plus the benchmark last.
 *
 * Written generically because four cards need exactly this shape — regional positioning,
 * credit rating, security type and maturity band all ask "how does each cohort's weight
 * in this bucket compare to the index?". Keeping the bucket on the x-axis and the cohort
 * in the color channel means color always encodes identity, never magnitude, and a
 * 8-bucket credit breakdown needs no eight-color ramp.
 */
export type BenchmarkGroup = {
  /** Bucket name — the x-axis category. */
  label: string;
  /** The benchmark's weight in this bucket, as a percentage. Null when not uploaded. */
  benchmark: number | null;
  /** Cohort name -> its weight (percentage) and delta vs the benchmark. */
  series: Record<string, { value: number; delta: number | null }>;
};

type DisplayedSeries = { name: string; idx: number; exiting: boolean };

type Props = {
  data: BenchmarkGroup[];
  displayedSeries: DisplayedSeries[];
  palette: ReadonlyArray<{ hex: string; glow: string }>;
  /** Label for the reference bar in the tooltip, e.g. "MSCI ACWI IMI". */
  benchmarkLabel?: string;
  /** Omits the reference bar entirely when the benchmark was never uploaded. */
  showBenchmark?: boolean;
  yMax?: number;
  // Extra delay (ms) applied to the shrink-cleanup timer so layout doesn't snap before
  // the visually-delayed shrink keyframe finishes. Pair with .row-stagger-2 in CSS, which
  // delays the rise/shrink keyframes themselves. Defaults to 0 (no stagger).
  staggerDelayMs?: number;
  /** Smaller type and tighter margins, for the three mini charts sharing one card. */
  compact?: boolean;
};

const SLIDE_MS = 550;
const SHRINK_MS = 550;
const INNER_GAP = 4;
const BENCHMARK_KEY = '__BENCHMARK__';

/**
 * Ticks on round numbers.
 *
 * Dividing the domain into a fixed four gives ticks like 13% and 38% for a 50% axis,
 * which are exact but unreadable — an axis is for estimating, and you cannot estimate
 * against a scale you have to do arithmetic on. Pick a round step instead and let the
 * tick count fall out of it.
 */
function ticksFor(yMax: number): number[] {
  const step = [5, 10, 20, 25, 50, 100].find((s) => yMax / s <= 5) ?? 100;
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
  return ticks;
}

/**
 * Percentages, with a decimal only where rounding would erase the answer.
 * A 0.4-point difference printed as "+0%" reads as "identical", which is a different
 * claim from "very close".
 */
function pct(value: number): string {
  // Below the decimal's own resolution, "0" is the honest answer — "+0.0%" implies a
  // measured-but-tiny difference where there is effectively none.
  if (Math.abs(value) < 0.05) return '0';
  if (Math.abs(value) < 1) return value.toFixed(1);
  return String(Math.round(value));
}

// Custom SVG bar chart that animates layout changes:
// - Adding a series: existing bars slide to make room (x/width transitions), then the new
//   bar rises in via a delayed scaleY keyframe so the slide-apart finishes first.
// - Removing a series: the exiting bar runs a shrink keyframe (scaleY 1→0, opacity 1→0)
//   over SHRINK_MS while siblings hold their slots. Once the shrink completes, the bar drops
//   out of the layout calculation and the remaining bars slide together over SLIDE_MS to
//   close the gap. The parent keeps the entry mounted for its full exit window so legend chips
//   etc. stay in sync.
export default function BenchmarkBarChart({
  data,
  displayedSeries,
  palette,
  benchmarkLabel = 'Benchmark',
  showBenchmark = true,
  yMax = 80,
  staggerDelayMs = 0,
  compact = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; group: BenchmarkGroup; key: string } | null>(null);

  const fontSize = compact ? 9 : 11;
  const marginLeft = compact ? 30 : 42;
  const marginRight = compact ? 4 : 8;

  // Bottom margin depends on whether the category labels have to rotate, and rotation
  // depends on how wide each group's slot is — which depends only on the left/right
  // margins, so the two resolve in order without circularity.
  const plotWidth = Math.max(0, size.w - marginLeft - marginRight);
  const slotW = data.length > 0 ? plotWidth / data.length : 0;
  // 'CCC & Below' beside 'Not Rated' in a third-width card is the case this exists for:
  // eight buckets at ~40px each overlap into an unreadable smear.
  const rotateLabels = slotW > 0 && slotW < 56 && data.some((g) => g.label.length > 5);

  const MARGIN = {
    top: compact ? 14 : 16,
    right: marginRight,
    left: marginLeft,
    bottom: rotateLabels ? 52 : compact ? 24 : 28,
  };

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const update = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setSize({ w: width, h: height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // The rising class is applied to every non-exiting bar/label. CSS keyframe animations only
  // play on first DOM mount of an element with the class — re-renders that don't change the
  // class string don't replay, so existing bars stay put while a freshly mounted bar (initial
  // page load OR newly-added series) rises into view.

  // Bars whose shrink animation has finished. Once a name lands here we drop it from the layout
  // calculation so the remaining bars slide together to close the gap.
  const [shrunkBars, setShrunkBars] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    displayedSeries.forEach(p => {
      if (p.exiting && !shrunkBars.has(p.name)) {
        timers.push(setTimeout(() => {
          setShrunkBars(prev => {
            if (prev.has(p.name)) return prev;
            const next = new Set(prev);
            next.add(p.name);
            return next;
          });
        }, SHRINK_MS + staggerDelayMs));
      }
    });
    return () => timers.forEach(clearTimeout);
  }, [displayedSeries, shrunkBars, staggerDelayMs]);

  // Drop names from shrunkBars once the parent has unmounted them, so a re-selection of the same
  // series is treated as a fresh entry.
  useEffect(() => {
    const currentNames = new Set(displayedSeries.map(p => p.name));
    const stale = [...shrunkBars].filter(n => !currentNames.has(n));
    if (stale.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShrunkBars(prev => {
      const next = new Set(prev);
      stale.forEach(n => next.delete(n));
      return next;
    });
  }, [displayedSeries, shrunkBars]);

  const chartW = Math.max(0, size.w - MARGIN.left - MARGIN.right);
  const chartH = Math.max(0, size.h - MARGIN.top - MARGIN.bottom);
  const nGroups = data.length;
  const groupSlotW = nGroups > 0 ? chartW / nGroups : 0;
  const groupWidth = groupSlotW * 0.78;

  // Render order is series in selection order, then the benchmark last.
  const barOrder = [
    ...displayedSeries.map(p => ({ kind: 'series' as const, name: p.name, idx: p.idx, exiting: p.exiting })),
    ...(showBenchmark ? [{ kind: 'index' as const, name: BENCHMARK_KEY, idx: -1, exiting: false }] : []),
  ];
  // Bars that hold a layout slot: everything except those that have already finished shrinking.
  // An exiting bar still holds its slot during SHRINK_MS so the shrink reads as in-place.
  const layoutBars = barOrder.filter(b => !shrunkBars.has(b.name));
  const nLayoutBars = layoutBars.length;
  const layoutBarWidth =
    nLayoutBars > 0 ? Math.max(0, (groupWidth - (nLayoutBars - 1) * INNER_GAP) / nLayoutBars) : 0;

  // A "-0.9%" is about 30px of text. Above a 16px bar it runs into its neighbours and the
  // whole row becomes an unreadable smear — the exact case where a direct label costs more
  // than it gives. Below this width the value drops to the tooltip, which every bar has,
  // and the axis still carries the magnitude.
  const showValueLabels = layoutBarWidth >= 20;

  const yToPx = (v: number) => MARGIN.top + chartH - (v / yMax) * chartH;
  const baseY = yToPx(0);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {size.w > 0 && size.h > 0 && (
        <svg width={size.w} height={size.h} style={{ overflow: 'visible' }}>
          {ticksFor(yMax).map(v => {
            const y = yToPx(v);
            return (
              <g key={v}>
                <line x1={MARGIN.left} x2={MARGIN.left + chartW} y1={y} y2={y} stroke={CHART_INK.grid} />
                <text
                  x={MARGIN.left - 8}
                  y={y}
                  fill={CHART_INK.tick}
                  fontSize={fontSize}
                  textAnchor="end"
                  dominantBaseline="central"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {v}%
                </text>
              </g>
            );
          })}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + chartW}
            y1={baseY}
            y2={baseY}
            stroke={CHART_INK.axis}
          />

          {data.map((group, groupIdx) => {
            const groupCx = MARGIN.left + groupSlotW * (groupIdx + 0.5);
            const startX = groupCx - groupWidth / 2;

            return (
              <g key={group.label}>
                <text
                  x={groupCx}
                  y={size.h - MARGIN.bottom + (rotateLabels ? 12 : 16)}
                  fill={CHART_INK.tick}
                  fontSize={fontSize}
                  textAnchor={rotateLabels ? 'end' : 'middle'}
                  transform={
                    rotateLabels
                      ? `rotate(-35, ${groupCx}, ${size.h - MARGIN.bottom + 12})`
                      : undefined
                  }
                >
                  {group.label}
                </text>

                {layoutBars.map((bar, j) => {
                  const x = startX + j * (layoutBarWidth + INNER_GAP);
                  const isIndex = bar.kind === 'index';
                  let value: number;
                  let color: { hex: string; glow: string };
                  let labelText: string;
                  let labelColor: string;
                  if (isIndex) {
                    value = group.benchmark ?? 0;
                    color = BENCHMARK_COLOR;
                    labelText = `${pct(value)}%`;
                    labelColor = '#d4d4d8';
                  } else {
                    const p = group.series[bar.name];
                    value = p?.value ?? 0;
                    const delta = p?.delta;
                    // Without a benchmark there is no delta to show, so the bar labels
                    // its own value rather than an invented "+0%".
                    labelText = delta == null
                      ? `${pct(value)}%`
                      : `${delta >= 0 ? '+' : ''}${pct(delta)}%`;
                    labelColor = delta == null ? '#d4d4d8' : delta >= 0 ? '#34d399' : '#f87171';
                    color = palette[bar.idx] ?? palette[0];
                  }
                  const h = (value / yMax) * chartH;
                  const y = yToPx(value);

                  return (
                    <BarSlot
                      key={bar.name}
                      x={x}
                      y={y}
                      width={layoutBarWidth}
                      height={h}
                      color={color}
                      isExiting={bar.exiting}
                      labelText={showValueLabels ? labelText : ''}
                      labelColor={labelColor}
                      fontSize={fontSize}
                      // Hit area spans the full plot height, not just the drawn bar, so a
                      // 3%-tall segment is still hoverable without pixel hunting.
                      hitTop={MARGIN.top}
                      hitHeight={chartH}
                      onEnter={() => setHover({ x: x + layoutBarWidth / 2, y, group, key: bar.name })}
                      onLeave={() => setHover(h2 => (h2?.key === bar.name && h2.group.label === group.label ? null : h2))}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-20 whitespace-nowrap border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: Math.min(Math.max(hover.x, 60), Math.max(60, size.w - 60)),
            top: Math.max(0, hover.y - 8),
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="mb-1 text-zinc-300">{hover.group.label}</div>
          {hover.key === BENCHMARK_KEY ? (
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2" style={{ background: BENCHMARK_COLOR.hex }} />
              <span className="text-zinc-400">{benchmarkLabel}</span>
              <span className="font-mono text-zinc-100">
                {(hover.group.benchmark ?? 0).toFixed(1)}%
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2"
                style={{ background: (palette[displayedSeries.find(s => s.name === hover.key)?.idx ?? 0] ?? palette[0]).hex }}
              />
              <span className="text-zinc-400">{hover.key}</span>
              <span className="font-mono text-zinc-100">
                {(hover.group.series[hover.key]?.value ?? 0).toFixed(1)}%
              </span>
              {hover.group.series[hover.key]?.delta != null && (
                <span
                  className="font-mono"
                  style={{ color: (hover.group.series[hover.key]!.delta ?? 0) >= 0 ? '#34d399' : '#f87171' }}
                >
                  {(hover.group.series[hover.key]!.delta ?? 0) >= 0 ? '+' : ''}
                  {(hover.group.series[hover.key]!.delta ?? 0).toFixed(1)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type BarSlotProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  color: { hex: string; glow: string };
  isExiting: boolean;
  labelText: string;
  labelColor: string;
  fontSize: number;
  hitTop: number;
  hitHeight: number;
  onEnter: () => void;
  onLeave: () => void;
};

function BarSlot({
  x, y, width, height, color, isExiting, labelText, labelColor, fontSize,
  hitTop, hitHeight, onEnter, onLeave,
}: BarSlotProps) {
  const transformOrigin = `${x + width / 2}px ${y + height}px`;
  // Layout (x/y/width/height) animates via CSS transition. Enter (rise) and exit (shrink) use
  // CSS keyframe animations applied via class — keyframes win over the inline scaleY/opacity
  // values so we don't have to fight the rising animation's fill state. The rising class is
  // applied to every non-exiting bar; the keyframe only plays on first DOM mount, so re-renders
  // that don't toggle the class don't replay it.
  const rectTransition =
    `x ${SLIDE_MS}ms ease-out, width ${SLIDE_MS}ms ease-out, ` +
    `y ${SLIDE_MS}ms ease-out, height ${SLIDE_MS}ms ease-out`;

  const rectClass = isExiting ? 'benchmark-bar--shrinking' : 'benchmark-bar--rising';
  const labelClass = isExiting ? 'benchmark-label--shrinking' : 'benchmark-label--rising';

  return (
    <g>
      <rect
        className={rectClass}
        x={x}
        y={y}
        width={Math.max(0, width)}
        height={Math.max(0, height)}
        fill={color.hex}
        rx={3}
        ry={3}
        style={{
          transformOrigin,
          filter: `drop-shadow(0 0 6px ${color.glow})`,
          transition: rectTransition,
        }}
      />
      <text
        className={labelClass}
        x={x + width / 2}
        y={y - 6}
        textAnchor="middle"
        fontSize={fontSize + 1}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill={labelColor}
        style={{
          transition: `x ${SLIDE_MS}ms ease-out, y ${SLIDE_MS}ms ease-out`,
        }}
      >
        {labelText}
      </text>
      {/* Invisible hit target covering the bar's full column. Last in the group so it
          sits above the painted bar and receives the pointer events. */}
      <rect
        x={x - INNER_GAP / 2}
        y={hitTop}
        width={Math.max(0, width + INNER_GAP)}
        height={hitHeight}
        fill="transparent"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{ cursor: 'default' }}
      />
    </g>
  );
}
