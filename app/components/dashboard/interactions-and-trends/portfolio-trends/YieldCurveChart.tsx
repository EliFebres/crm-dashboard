'use client';

import React from 'react';
import {
  CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { CohortAggregate, YieldCurvePoint } from '@/app/lib/types/portfolioTrends';
import { BENCHMARK_COLOR, CHART_INK, cohortColor } from './chartTokens';

/**
 * The Treasury par curve, with each cohort placed on it at its own effective duration.
 *
 * The x-axis is years, not tenor labels — that is what lets a cohort with 6.2 years of
 * duration sit between the 5Y and 7Y points instead of being snapped to a category. Both
 * series share the one y-axis (yield), so nothing here invents a correlation the way a
 * second scale would.
 *
 * The marker answers the question the card is actually for: given where rates are, where
 * on the curve is this portfolio taking its interest-rate risk?
 */

interface Props {
  curve: YieldCurvePoint[];
  cohorts: CohortAggregate[];
  benchmark: (CohortAggregate & { ref: { id: string; name: string } }) | null;
  allCohorts: readonly string[];
}

/** '3M' -> 0.25, '10Y' -> 10. Anything unparseable sorts to the end and is dropped. */
function tenorYears(tenor: string): number | null {
  const match = /^(\d+)([MY])$/.exec(tenor);
  if (!match) return null;
  const n = Number(match[1]);
  return match[2] === 'Y' ? n : n / 12;
}

/** Linear interpolation along the curve, so a duration between two tenors reads off it. */
function yieldAt(curve: Array<{ years: number; yield: number }>, years: number): number | null {
  if (curve.length === 0) return null;
  if (years <= curve[0].years) return curve[0].yield;
  if (years >= curve[curve.length - 1].years) return curve[curve.length - 1].yield;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    if (years <= b.years) {
      const t = (years - a.years) / (b.years - a.years || 1);
      return a.yield + t * (b.yield - a.yield);
    }
  }
  return null;
}

/** Module scope, not defined inside the chart's render — see CharacteristicScatter. */
function CurveTooltip({
  active, payload,
}: { active?: boolean; payload?: Array<{ payload?: { tenor: string; yield: number } }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-zinc-300">{p.tenor} Treasury</div>
      <div className="font-mono tabular-nums text-cyan-300">{(p.yield * 100).toFixed(2)}%</div>
    </div>
  );
}

export default function YieldCurveChart({ curve, cohorts, benchmark, allCohorts }: Props) {
  const points = curve
    .map((p) => ({ ...p, years: tenorYears(p.tenor) }))
    .filter((p): p is YieldCurvePoint & { years: number } => p.years != null)
    .sort((a, b) => a.years - b.years);

  if (points.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
        No Treasury curve uploaded for this period.
      </div>
    );
  }

  interface DurationMarker { name: string; duration: number; color: string }

  const markers: DurationMarker[] = [
    ...cohorts.map((c): DurationMarker | null => (
      typeof c.characteristics.effectiveDuration === 'number'
        ? {
            name: c.cohort,
            duration: c.characteristics.effectiveDuration,
            color: cohortColor(c.cohort, allCohorts).hex,
          }
        : null
    )),
    benchmark && typeof benchmark.characteristics.effectiveDuration === 'number'
      ? {
          name: benchmark.ref.name,
          duration: benchmark.characteristics.effectiveDuration,
          color: BENCHMARK_COLOR.hex as string,
        }
      : null,
  ].filter((m): m is DurationMarker => m !== null);

  return (
    <div className="flex flex-1 flex-col">
      <ClientOnlyChart>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 10, right: 12, bottom: 16, left: 0 }}>
            <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
            <XAxis
              type="number"
              dataKey="years"
              scale="log"
              domain={['dataMin', 'dataMax']}
              ticks={points.map((p) => p.years)}
              tickFormatter={(v: number) => points.find((p) => p.years === v)?.tenor ?? ''}
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              label={{ value: 'Maturity', position: 'insideBottom', offset: -10, fill: CHART_INK.muted, fontSize: 10 }}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              width={44}
              tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
            />
            <Tooltip content={<CurveTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
            <Line
              type="monotone"
              dataKey="yield"
              stroke="#22d3ee"
              strokeWidth={2}
              dot={{ r: 3, fill: '#22d3ee', stroke: 'none' }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            {markers.map((m) => {
              const y = yieldAt(points.map((p) => ({ years: p.years, yield: p.yield })), m.duration);
              if (y == null) return null;
              return (
                <ReferenceDot
                  key={m.name}
                  x={m.duration}
                  y={y}
                  r={5.5}
                  fill={m.color}
                  stroke="#131316"
                  strokeWidth={2}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </ClientOnlyChart>

      {markers.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
          <span className="text-zinc-600">Effective duration:</span>
          {markers.map((m) => (
            <span key={m.name} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: m.color }} />
              <span className="text-zinc-400">{m.name}</span>
              <span className="font-mono tabular-nums text-zinc-300">{m.duration.toFixed(1)}y</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
