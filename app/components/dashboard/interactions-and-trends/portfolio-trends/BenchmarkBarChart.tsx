'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type BenchmarkRegion = {
  region: string;
  acwi: number;
  portfolios: Record<string, { client: number; delta: number }>;
};

type DisplayedPortfolio = { name: string; idx: number; exiting: boolean };

type Props = {
  data: BenchmarkRegion[];
  displayedPortfolios: DisplayedPortfolio[];
  palette: ReadonlyArray<{ hex: string; glow: string }>;
  yMax?: number;
  // Extra delay (ms) applied to the shrink-cleanup timer so layout doesn't snap before
  // the visually-delayed shrink keyframe finishes. Pair with .row-stagger-2 in CSS, which
  // delays the rise/shrink keyframes themselves. Defaults to 0 (no stagger).
  staggerDelayMs?: number;
};

const MARGIN = { top: 16, right: 8, left: 42, bottom: 28 };
const SLIDE_MS = 550;
const SHRINK_MS = 550;
const INNER_GAP = 4;
const Y_TICKS = [0, 20, 40, 60, 80];
const ACWI_KEY = '__ACWI__';
const ACWI_COLOR = { hex: '#71717a', glow: 'rgba(113,113,122,0.4)' };

// Custom SVG bar chart that animates layout changes:
// - Adding a portfolio: existing bars slide to make room (x/width transitions), then the new
//   bar rises in via a delayed scaleY keyframe so the slide-apart finishes first.
// - Removing a portfolio: the exiting bar runs a shrink keyframe (scaleY 1→0, opacity 1→0)
//   over SHRINK_MS while siblings hold their slots. Once the shrink completes, the bar drops
//   out of the layout calculation and the remaining bars slide together over SLIDE_MS to
//   close the gap. The parent keeps the entry mounted for its full exit window so legend chips
//   etc. stay in sync.
export default function BenchmarkBarChart({ data, displayedPortfolios, palette, yMax = 80, staggerDelayMs = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

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
  // page load OR newly-added portfolio) rises into view.

  // Bars whose shrink animation has finished. Once a name lands here we drop it from the layout
  // calculation so the remaining bars slide together to close the gap.
  const [shrunkBars, setShrunkBars] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    displayedPortfolios.forEach(p => {
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
  }, [displayedPortfolios, shrunkBars, staggerDelayMs]);

  // Drop names from shrunkBars once the parent has unmounted them, so a re-selection of the same
  // portfolio is treated as a fresh entry.
  useEffect(() => {
    const currentNames = new Set(displayedPortfolios.map(p => p.name));
    const stale = [...shrunkBars].filter(n => !currentNames.has(n));
    if (stale.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShrunkBars(prev => {
      const next = new Set(prev);
      stale.forEach(n => next.delete(n));
      return next;
    });
  }, [displayedPortfolios, shrunkBars]);

  const chartW = Math.max(0, size.w - MARGIN.left - MARGIN.right);
  const chartH = Math.max(0, size.h - MARGIN.top - MARGIN.bottom);
  const nRegions = data.length;
  const groupSlotW = nRegions > 0 ? chartW / nRegions : 0;
  const groupWidth = groupSlotW * 0.78;

  // Render order is portfolios in selection order, then ACWI last.
  const barOrder = [
    ...displayedPortfolios.map(p => ({ kind: 'portfolio' as const, name: p.name, idx: p.idx, exiting: p.exiting })),
    { kind: 'index' as const, name: ACWI_KEY, idx: -1, exiting: false },
  ];
  // Bars that hold a layout slot: everything except those that have already finished shrinking.
  // An exiting bar still holds its slot during SHRINK_MS so the shrink reads as in-place.
  const layoutBars = barOrder.filter(b => !shrunkBars.has(b.name));
  const nLayoutBars = layoutBars.length;
  const layoutBarWidth =
    nLayoutBars > 0 ? Math.max(0, (groupWidth - (nLayoutBars - 1) * INNER_GAP) / nLayoutBars) : 0;

  const yToPx = (v: number) => MARGIN.top + chartH - (v / yMax) * chartH;
  const baseY = yToPx(0);

  return (
    <div ref={containerRef} className="w-full h-full">
      {size.w > 0 && size.h > 0 && (
        <svg width={size.w} height={size.h} style={{ overflow: 'visible' }}>
          {Y_TICKS.map(v => {
            const y = yToPx(v);
            return (
              <g key={v}>
                <line x1={MARGIN.left} x2={MARGIN.left + chartW} y1={y} y2={y} stroke="rgba(82,82,91,0.25)" />
                <text
                  x={MARGIN.left - 8}
                  y={y}
                  fill="#a5a5b2"
                  fontSize={11}
                  textAnchor="end"
                  dominantBaseline="central"
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
            stroke="rgba(82,82,91,0.6)"
          />

          {data.map((region, regionIdx) => {
            const groupCx = MARGIN.left + groupSlotW * (regionIdx + 0.5);
            const startX = groupCx - groupWidth / 2;

            return (
              <g key={region.region}>
                <text
                  x={groupCx}
                  y={size.h - MARGIN.bottom + 16}
                  fill="#a5a5b2"
                  fontSize={11}
                  textAnchor="middle"
                >
                  {region.region}
                </text>

                {layoutBars.map((bar, j) => {
                  const x = startX + j * (layoutBarWidth + INNER_GAP);
                  const isIndex = bar.kind === 'index';
                  let value: number;
                  let color: { hex: string; glow: string };
                  let labelText: string;
                  let labelColor: string;
                  if (isIndex) {
                    value = region.acwi;
                    color = ACWI_COLOR;
                    labelText = `${value}%`;
                    labelColor = '#d4d4d8';
                  } else {
                    const p = region.portfolios[bar.name];
                    value = p?.client ?? 0;
                    const delta = p?.delta ?? 0;
                    labelText = `${delta >= 0 ? '+' : ''}${delta}%`;
                    labelColor = delta >= 0 ? '#34d399' : '#f87171';
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
                      labelText={labelText}
                      labelColor={labelColor}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
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
};

function BarSlot({ x, y, width, height, color, isExiting, labelText, labelColor }: BarSlotProps) {
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
        fontSize={12}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fill={labelColor}
        style={{
          transition: `x ${SLIDE_MS}ms ease-out, y ${SLIDE_MS}ms ease-out`,
        }}
      >
        {labelText}
      </text>
    </g>
  );
}
