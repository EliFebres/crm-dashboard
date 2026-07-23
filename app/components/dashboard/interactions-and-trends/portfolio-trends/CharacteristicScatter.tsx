'use client';

import React from 'react';
import {
  CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { CohortAggregate, Characteristics, ModelPoint } from '@/app/lib/types/portfolioTrends';
import {
  BENCHMARK_COLOR, CHART_INK, MODEL_CLOUD_COLOR, SCATTER_COHORT_LIMIT, cohortColor,
} from './chartTokens';
import { formatMetric, type MetricFormat } from './MetricsTable';

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
  /** Market cap spans orders of magnitude; a linear axis collapses everything but mega-cap. */
  logX?: boolean;
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
  xMetric, yMetric, xLabel, yLabel, xFormat, yFormat, logX = false,
}: Props) {
  const modelPoints: Point[] = models
    .map((m): Point | null => {
      const xy = extract(m.characteristics, xMetric, yMetric);
      if (!xy || (logX && xy.x <= 0)) return null;
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
      if (!xy || (logX && xy.x <= 0)) return null;
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
    benchmarkXy && !(logX && benchmarkXy.x <= 0)
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
            <CartesianGrid stroke={CHART_INK.grid} />
            <XAxis
              type="number"
              dataKey="x"
              scale={logX ? 'log' : 'linear'}
              domain={logX ? ['auto', 'auto'] : ['dataMin', 'dataMax']}
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              tickFormatter={(v: number) => formatMetric(v, xFormat)}
              label={{ value: xLabel, position: 'insideBottom', offset: -12, fill: CHART_INK.muted, fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              width={46}
              tickFormatter={(v: number) => formatMetric(v, yFormat)}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', fill: CHART_INK.muted, fontSize: 10, style: { textAnchor: 'middle' } }}
            />
            <ZAxis range={[36, 36]} />
            <Tooltip
              content={
                <ScatterTooltip
                  xLabel={xLabel} yLabel={yLabel} xFormat={xFormat} yFormat={yFormat}
                />
              }
              cursor={{ strokeDasharray: '0', stroke: 'rgba(255,255,255,0.15)' }}
            />

            {/* Cloud first, so cohort and index marks paint over it. */}
            <Scatter data={modelPoints} fill={MODEL_CLOUD_COLOR} isAnimationActive={false} />
            <Scatter data={cohortPoints} shape={<CohortDot />} isAnimationActive={false} />
            {benchmarkPoints.length > 0 && (
              <Scatter data={benchmarkPoints} shape={<BenchmarkDot />} isAnimationActive={false} />
            )}
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
