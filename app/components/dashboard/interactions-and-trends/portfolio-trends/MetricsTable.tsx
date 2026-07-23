'use client';

import React from 'react';
import type { CohortAggregate, Characteristics } from '@/app/lib/types/portfolioTrends';
import { BENCHMARK_COLOR, DELTA_INK, cohortColor } from './chartTokens';

/**
 * Metric rows: each cohort's value beside the index's, with the delta.
 *
 * This is a table on purpose. Four scalars compared against a reference is not a chart —
 * a bar chart of price-to-book against duration would be a dual-scale lie, and four
 * separate sparklines would bury the comparison the card exists to make. It also serves
 * as the table-view twin the scatter cards need for accessibility: every number plotted
 * as a dot over there is readable as text here.
 *
 * Each cell carries the value and its delta against the index, and nothing else. The
 * per-metric model count (`CohortAggregate.metricCounts`) is still in the response and
 * still worth reading when a figure looks off — it is what distinguishes an average over
 * forty models from one over two — but the Data Metrics strip above already tells the
 * reader how much data is in scope, so repeating a count in twenty cells was noise.
 */

export type MetricFormat = 'money' | 'ratio' | 'percent' | 'count' | 'years' | 'text';

export interface MetricSpec {
  key: keyof Characteristics;
  label: string;
  format: MetricFormat;
}

const EM_DASH = '—';

/** One decimal, but not a pointless one — a $100B axis tick reads "$100B", not "$100.0B". */
function scaled(value: number, unit: number, suffix: string): string {
  const n = value / unit;
  return `$${Number.isInteger(n) ? n : n.toFixed(1)}${suffix}`;
}

function formatCompactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return scaled(value, 1e12, 'T');
  if (abs >= 1e9) return scaled(value, 1e9, 'B');
  if (abs >= 1e6) return scaled(value, 1e6, 'M');
  if (abs >= 1e3) return scaled(value, 1e3, 'K');
  return `$${value.toFixed(0)}`;
}

export function formatMetric(value: number | string | undefined, format: MetricFormat): string {
  if (value == null) return EM_DASH;
  if (format === 'text') return String(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return EM_DASH;
  switch (format) {
    case 'money': return formatCompactMoney(n);
    // Stored as decimal fractions throughout, so the x100 happens here and only here.
    case 'percent': return `${(n * 100).toFixed(1)}%`;
    case 'count': return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    case 'years': return `${n.toFixed(1)} yr`;
    default: return n.toFixed(2);
  }
}

/**
 * Axis-tick form of a value.
 *
 * Trailing zeros are dropped for money and percentages, where "$100.0B" and "20.0%" carry
 * a decimal that means nothing. Ratios keep both places: a price-to-book axis is read
 * against values like 2.95, so 2 decimals is the precision of the measure itself and
 * showing "3" beside "2.95" would imply the two were measured differently.
 */
export function formatAxisTick(value: number, format: MetricFormat): string {
  if (format === 'ratio') return formatMetric(value, format);
  return formatMetric(value, format)
    .replace(/(\.\d*?)0+(?=[^\d]|$)/, '$1')
    .replace(/\.(?=[^\d]|$)/, '');
}

/** Delta rendered in the metric's own units, so "+0.4 yr" reads as duration, not percent. */
function formatDelta(delta: number, format: MetricFormat): string {
  const sign = delta >= 0 ? '+' : '';
  switch (format) {
    case 'money': return `${sign}${formatCompactMoney(delta).replace('$-', '-$')}`;
    case 'percent': return `${sign}${(delta * 100).toFixed(1)}pp`;
    case 'count': return `${sign}${Math.round(delta).toLocaleString()}`;
    case 'years': return `${sign}${delta.toFixed(1)}`;
    default: return `${sign}${delta.toFixed(2)}`;
  }
}

interface Props {
  metrics: MetricSpec[];
  cohorts: CohortAggregate[];
  benchmark: (CohortAggregate & { ref: { id: string; name: string } }) | null;
  /** Full option list — colors key off this so deselecting never repaints survivors. */
  allCohorts: readonly string[];
}

export default function MetricsTable({ metrics, cohorts, benchmark, allCohorts }: Props) {
  if (cohorts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
        No analytics for the current filters.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-x-auto">
      <table className="w-full min-w-[280px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-1.5 pr-2 text-left font-medium text-zinc-500">Metric</th>
            {cohorts.map((c) => {
              const color = cohortColor(c.cohort, allCohorts);
              return (
                <th key={c.cohort} className="py-1.5 px-2 text-right font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2 w-2 flex-shrink-0" style={{ background: color.hex }} />
                    <span className="truncate text-zinc-300" title={c.cohort}>{c.cohort}</span>
                  </span>
                </th>
              );
            })}
            {benchmark && (
              <th className="py-1.5 pl-2 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 flex-shrink-0" style={{ background: BENCHMARK_COLOR.hex }} />
                  <span className="truncate text-zinc-400" title={benchmark.ref.name}>Index</span>
                </span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => {
            const indexValue = benchmark?.characteristics[metric.key];
            return (
              <tr key={String(metric.key)} className="border-b border-zinc-800/50 last:border-0">
                <td className="py-1.5 pr-2 text-zinc-400">{metric.label}</td>
                {cohorts.map((c) => {
                  const value = c.characteristics[metric.key];
                  const canDelta =
                    typeof value === 'number' && typeof indexValue === 'number' && metric.format !== 'text';
                  const delta = canDelta ? (value as number) - (indexValue as number) : null;
                  return (
                    <td key={c.cohort} className="py-1.5 px-2 text-right align-top">
                      <div className="font-mono tabular-nums text-zinc-100">
                        {formatMetric(value, metric.format)}
                      </div>
                      <div className="flex items-center justify-end text-[10px]">
                        {delta != null && (
                          <span
                            className="font-mono tabular-nums"
                            style={{ color: delta >= 0 ? DELTA_INK.up : DELTA_INK.down }}
                          >
                            {formatDelta(delta, metric.format)}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
                {benchmark && (
                  <td className="py-1.5 pl-2 text-right align-top font-mono tabular-nums text-zinc-400">
                    {formatMetric(indexValue, metric.format)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
