'use client';

import React from 'react';
import {
  ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { CohortAggregate, Characteristics, ModelPoint } from '@/app/lib/types/portfolioTrends';
import {
  BENCHMARK_COLOR, CHART_INK, MODEL_CLOUD_COLOR, SCATTER_COHORT_LIMIT, cohortColor,
} from './chartTokens';
import { formatAxisTick, formatMetric, type MetricFormat } from './MetricsTable';

/**
 * Two-metric positioning: every model as a faint dot, each cohort's average as a solid
 * labelled dot, the index as a ring.
 *
 * The cloud is the point of the form. A cohort average on its own is a single number that
 * a stat tile would show better; plotted over the spread of the models behind it, it says
 * whether that average describes a tight group or hides two clusters.
 *
 * Cohort count is capped at SCATTER_COHORT_LIMIT — three — because scatter is an
 * all-pairs form (any two dots can land side by side) and no ordering of the palette
 * keeps more than three hues distinguishable under deuteranopia when all pairs are in
 * play. Past three, the extra cohorts fall back to the table beneath rather than taking
 * a fourth hue that some readers cannot separate from the third. Cohort dots are also
 * directly labelled, so identity never rests on color alone.
 *
 * There is no gridline layer. The only rules on the plot are a horizontal and a vertical
 * one crossing at the index, which turns the plot into four quadrants read against the
 * benchmark — cheaper/richer against larger/smaller — so a dot's position states its
 * relationship to the index directly instead of requiring two trips to the axes. A grid
 * behind that would compete with the one comparison the card exists to make. With no
 * benchmark uploaded there is nothing to cross at, and the plot carries no rules at all.
 */

interface Props {
  models: ModelPoint[];
  cohorts: CohortAggregate[];
  benchmark: (CohortAggregate & { ref: { id: string; name: string } }) | null;
  allCohorts: readonly string[];
  xMetric: keyof Characteristics;
  yMetric: keyof Characteristics;
  xLabel: string;
  yLabel: string;
  xFormat: MetricFormat;
  yFormat: MetricFormat;
}

interface Point {
  x: number;
  y: number;
  label: string;
  sublabel?: string;
  kind: 'model' | 'cohort' | 'benchmark';
  color: string;
  /**
   * Vertical offset for the direct label, in pixels.
   *
   * Cohort averages and the index routinely land within a few pixels of each other —
   * that closeness is the finding — so labels drawn at a fixed offset collide and become
   * unreadable exactly when the chart is most interesting. Cohorts stack upward, the
   * index sits below, and every label is centred over its own dot.
   */
  labelDy: number;
}

/**
 * Tick steps, as multiples of a power of ten.
 *
 * Restricted to 1 / 2 / 5 so a step is always a number people count in — 0.5, 1, 2, 5 on
 * a ratio axis; $100M, $500M, $100B on a money one. Never 0.92 or $74B, which is what
 * dividing the range into a fixed number of slices produces and what makes a reader do
 * arithmetic to place a dot. 2.5 is deliberately absent: it would put a ratio axis on
 * quarter steps.
 */
const NICE_STEPS = [5, 2, 1];

/** Always this many labels, so both scatters read the same way at a glance. */
const TARGET_TICKS = 5;

/** Candidate steps around `span`, coarsest first: …50, 20, 10, 5, 2, 1, 0.5, 0.2… */
function stepLadder(span: number): number[] {
  const base = Math.pow(10, Math.floor(Math.log10(span > 0 ? span : 1)));
  const out: number[] = [];
  for (const magnitude of [base * 10, base, base / 10, base / 100]) {
    for (const m of NICE_STEPS) out.push(m * magnitude);
  }
  return out;
}

/**
 * A domain and exactly {@link TARGET_TICKS} ticks, every one on a round number.
 *
 * The step is chosen from the ladder, so it scales with the spread on its own: a market
 * cap axis covering $430B lands on $100B steps, one covering $2B lands on $500M, and a
 * price-to-book axis lands on 1s or 0.5s. Nobody picks a granularity per chart.
 *
 * Two constructions, in order of preference:
 *
 *  1. Pad the data range and look for a step whose multiples put exactly five ticks
 *     *inside* that range. This is the common case and wastes no space.
 *  2. Failing that, build the domain out of the ticks themselves — five of them from the
 *     largest multiple at or below the minimum. Guaranteed to produce five, at the cost
 *     of some empty plot, since a step coarse enough to span the data in four intervals
 *     usually overshoots the top.
 *
 * Preferring (1) matters: (2) applied to a $40B–$470B axis needs $200B steps and runs the
 * axis to $800B, leaving 40% of the plot empty. (1) finds $100B steps inside a padded
 * range instead. A scatter is read by relative position and has no baseline to be honest
 * about, so there is nothing lost by not starting at zero.
 */
function niceAxis(values: number[]): { domain: [number, number]; ticks: number[] } | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  // Every point sharing one value has no spread to tick against; give it a window so the
  // dots don't collapse onto the axis edge.
  const spread = max === min ? Math.abs(min) * 0.1 || 1 : max - min;
  const lo = min - spread * 0.08;
  const hi = max + spread * 0.08;

  for (const step of stepLadder(hi - lo)) {
    const ticks = ticksWithin(lo, hi, step);
    if (ticks.length === TARGET_TICKS) return { domain: [lo, hi], ticks };
  }

  // Fallback: finest step whose five ticks still reach past the data.
  for (const step of [...stepLadder(spread)].reverse()) {
    const first = Math.floor(min / step) * step;
    if (first + (TARGET_TICKS - 1) * step >= max) {
      const ticks = Array.from({ length: TARGET_TICKS }, (_, i) =>
        Number((first + i * step).toPrecision(12))
      );
      return { domain: [ticks[0], ticks[TARGET_TICKS - 1]], ticks };
    }
  }
  return null;
}

function ticksWithin(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  if (!(step > 0)) return out;
  const first = Math.ceil(lo / step) * step;
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    // Re-round each tick: repeated addition of 0.1 drifts to 0.30000000000000004, which
    // the formatter would happily print.
    out.push(Number((Math.round(v / step) * step).toPrecision(12)));
  }
  return out;
}

function extract(
  c: Characteristics, xMetric: keyof Characteristics, yMetric: keyof Characteristics
): { x: number; y: number } | null {
  const x = c[xMetric];
  const y = c[yMetric];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/**
 * The direct label. Centred over its dot and painted with a surface-colored stroke
 * underneath, so it stays legible over the model cloud without a background box.
 */
function DotLabel({ cx, cy, payload, fill }: { cx: number; cy: number; payload: Point; fill: string }) {
  return (
    <text
      x={cx}
      y={cy + payload.labelDy}
      fill={fill}
      fontSize={10}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ paintOrder: 'stroke', stroke: '#131316', strokeWidth: 3.5 }}
    >
      {payload.label}
    </text>
  );
}

/** Solid dot with a 2px surface ring, so overlapping cohort marks stay separable. */
function CohortDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="#131316" />
      <circle cx={cx} cy={cy} r={5.5} fill={payload.color} />
      <DotLabel cx={cx} cy={cy} payload={payload} fill="#e4e4e7" />
    </g>
  );
}

/** The index reads as a ring, not a filled dot — a reference, not another series. */
function BenchmarkDot(props: { cx?: number; cy?: number; payload?: Point }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="#131316" />
      <circle cx={cx} cy={cy} r={5.5} fill="none" stroke={BENCHMARK_COLOR.hex} strokeWidth={2} />
      <DotLabel cx={cx} cy={cy} payload={payload} fill="#a1a1aa" />
    </g>
  );
}

/**
 * Declared at module scope and handed to Recharts as an element, not defined inside the
 * chart's render — a component created during render remounts on every re-render and
 * loses its state.
 */
function ScatterTooltip({
  active, payload, xLabel, yLabel, xFormat, yFormat,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Point }>;
  xLabel: string;
  yLabel: string;
  xFormat: MetricFormat;
  yFormat: MetricFormat;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg">
      <div className="flex items-center gap-1.5 text-zinc-200">
        <span
          className="inline-block h-2 w-2 flex-shrink-0"
          style={{
            background: p.kind === 'benchmark' ? 'transparent' : p.color,
            boxShadow: p.kind === 'benchmark' ? `inset 0 0 0 1.5px ${BENCHMARK_COLOR.hex}` : undefined,
          }}
        />
        {p.label}
      </div>
      {p.sublabel && <div className="text-[10px] text-zinc-500">{p.sublabel}</div>}
      <div className="mt-1 font-mono tabular-nums text-zinc-300">
        {xLabel}: {formatMetric(p.x, xFormat)}
      </div>
      <div className="font-mono tabular-nums text-zinc-300">
        {yLabel}: {formatMetric(p.y, yFormat)}
      </div>
    </div>
  );
}

export default function CharacteristicScatter({
  models, cohorts, benchmark, allCohorts,
  xMetric, yMetric, xLabel, yLabel, xFormat, yFormat,
}: Props) {

  const modelPoints: Point[] = models
    .map((m): Point | null => {
      const xy = extract(m.characteristics, xMetric, yMetric);
      if (!xy) return null;
      return {
        ...xy,
        label: m.modelName,
        sublabel: m.clientName,
        kind: 'model',
        color: MODEL_CLOUD_COLOR,
        labelDy: 0, // cloud points are never labelled
      };
    })
    .filter((p): p is Point => p !== null);

  const shown = cohorts.slice(0, SCATTER_COHORT_LIMIT);
  const hiddenCount = cohorts.length - shown.length;

  const cohortPoints: Point[] = shown
    .map((c, i): Point | null => {
      const xy = extract(c.characteristics, xMetric, yMetric);
      if (!xy) return null;
      return {
        ...xy,
        label: c.cohort,
        kind: 'cohort',
        color: cohortColor(c.cohort, allCohorts).hex,
        // Stack upward from the dot so several near-coincident cohorts stay readable.
        // The first step clears both its own 7px dot and the index's, which routinely
        // sits within a pixel or two of a cohort average.
        labelDy: -17 - i * 12,
      };
    })
    .filter((p): p is Point => p !== null);

  const benchmarkXy = benchmark ? extract(benchmark.characteristics, xMetric, yMetric) : null;
  const benchmarkPoints: Point[] =
    benchmarkXy
      ? [{
          ...benchmarkXy,
          label: benchmark!.ref.name,
          kind: 'benchmark' as const,
          color: BENCHMARK_COLOR.hex as string,
          // Below the dot — the opposite side from the cohorts, which is what keeps the
          // two apart when a cohort average sits right on top of the index.
          labelDy: 18,
        }]
      : [];

  const allPoints = [...modelPoints, ...cohortPoints, ...benchmarkPoints];
  const xAxis = niceAxis(allPoints.map((p) => p.x));
  const yAxis = niceAxis(allPoints.map((p) => p.y));

  if (cohortPoints.length === 0 && modelPoints.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
        No {xLabel.toLowerCase()} / {yLabel.toLowerCase()} data for the current filters.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <ClientOnlyChart>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 4 }}>
            {/* No CartesianGrid and no axis rules — the crosshairs below are the only
                lines on the plot. Numeric axes ascend left-to-right and bottom-to-top. */}
            <XAxis
              type="number"
              dataKey="x"
              domain={xAxis?.domain ?? ['auto', 'auto']}
              ticks={xAxis?.ticks}
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatAxisTick(v, xFormat)}
              label={{ value: xLabel, position: 'insideBottom', offset: -12, fill: CHART_INK.muted, fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={yAxis?.domain ?? ['auto', 'auto']}
              ticks={yAxis?.ticks}
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              // '$1,234.5B' needs more room than '3.92'.
              width={yFormat === 'money' ? 58 : 46}
              tickFormatter={(v: number) => formatAxisTick(v, yFormat)}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: CHART_INK.muted, fontSize: 10, style: { textAnchor: 'middle' } }}
            />
            <ZAxis range={[36, 36]} />

            {/* The crosshairs. Declared before the marks so they paint underneath, and
                only when there is an index to cross at. */}
            {benchmarkPoints.length > 0 && (
              <ReferenceLine
                x={benchmarkPoints[0].x}
                stroke={BENCHMARK_COLOR.hex}
                strokeOpacity={0.45}
                strokeWidth={1}
              />
            )}
            {benchmarkPoints.length > 0 && (
              <ReferenceLine
                y={benchmarkPoints[0].y}
                stroke={BENCHMARK_COLOR.hex}
                strokeOpacity={0.45}
                strokeWidth={1}
              />
            )}
            <Tooltip
              content={
                <ScatterTooltip
                  xLabel={xLabel} yLabel={yLabel} xFormat={xFormat} yFormat={yFormat}
                />
              }
              cursor={{ strokeDasharray: '0', stroke: 'rgba(255,255,255,0.15)' }}
            />

            {/* Cloud first, then the index, then the cohorts — so a cohort's label paints
                over the index ring rather than being struck through by it when the two
                land on top of each other, which is exactly when the card matters most. */}
            <Scatter data={modelPoints} fill={MODEL_CLOUD_COLOR} isAnimationActive={false} />
            {benchmarkPoints.length > 0 && (
              <Scatter data={benchmarkPoints} shape={<BenchmarkDot />} isAnimationActive={false} />
            )}
            <Scatter data={cohortPoints} shape={<CohortDot />} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </ClientOnlyChart>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: MODEL_CLOUD_COLOR }} />
          {modelPoints.length} model{modelPoints.length === 1 ? '' : 's'}
        </span>
        {benchmarkPoints.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ boxShadow: `inset 0 0 0 1.5px ${BENCHMARK_COLOR.hex}` }}
            />
            {benchmark!.ref.name}
          </span>
        )}
        {hiddenCount > 0 && (
          <span className="text-zinc-600">
            {hiddenCount} more cohort{hiddenCount === 1 ? '' : 's'} in the table — a scatter
            can only carry {SCATTER_COHORT_LIMIT} distinguishable colors
          </span>
        )}
      </div>
    </div>
  );
}
