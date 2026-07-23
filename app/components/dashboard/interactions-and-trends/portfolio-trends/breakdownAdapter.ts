'use client';

import { useEffect, useRef, useState } from 'react';
import type { BreakdownSeries } from '@/app/lib/types/portfolioTrends';
import type { BenchmarkGroup } from './BenchmarkBarChart';
import { cohortSlot } from './chartTokens';

/**
 * Adapters between the wire format (weights as 0..1 fractions, keyed by bucket) and what
 * BenchmarkBarChart draws (percentages, grouped by bucket with a series per cohort).
 */

/** Exit-animation window in BenchmarkBarChart — a series stays mounted this long after deselection. */
const EXIT_MS = 1100;

/**
 * Turn one dimension into chart groups.
 *
 * Buckets come from `series.buckets`, which is the canonical order the server supplies —
 * never sorted by value here. Sorting bars by magnitude would make the x-axis mean
 * something different on every render, and for ordered dimensions (credit quality,
 * maturity) it would destroy the ordering that is the whole point of the chart.
 *
 * A bucket a cohort never reported is 0, not missing: absence from a distribution means
 * zero weight, and dropping the bar would silently narrow the axis.
 */
export function toGroups(
  series: BreakdownSeries | undefined,
  selectedCohorts: readonly string[]
): BenchmarkGroup[] {
  if (!series) return [];
  return series.buckets.map((bucket) => {
    const benchmark = series.benchmark ? (series.benchmark[bucket] ?? 0) * 100 : null;
    const seriesValues: BenchmarkGroup['series'] = {};
    for (const cohort of selectedCohorts) {
      const weights = series.cohorts[cohort];
      if (!weights) continue;
      const value = (weights[bucket] ?? 0) * 100;
      seriesValues[cohort] = {
        value,
        delta: benchmark == null ? null : value - benchmark,
        // Absent when the upload carried no counts — distinct from a count of zero, so
        // the tooltip can omit the line rather than claim "0 names".
        names: series.cohortNames[cohort]?.[bucket],
      };
    }
    return {
      label: bucket,
      benchmark,
      benchmarkNames: series.benchmarkNames?.[bucket] ?? null,
      series: seriesValues,
    };
  });
}

/** True when at least one cohort reported this dimension. */
export function hasData(series: BreakdownSeries | undefined, selectedCohorts: readonly string[]): boolean {
  if (!series) return false;
  return selectedCohorts.some((c) => series.cohorts[c] && Object.keys(series.cohorts[c]).length > 0);
}

/**
 * A y-max that leaves headroom for the value label above the tallest bar, rounded to a
 * readable step. Never below 20, so a dimension where everything is small still gets a
 * sane axis rather than one that magnifies noise.
 */
export function yMaxFor(groups: BenchmarkGroup[]): number {
  let max = 0;
  for (const g of groups) {
    if (g.benchmark != null) max = Math.max(max, g.benchmark);
    for (const s of Object.values(g.series)) max = Math.max(max, s.value);
  }
  const withHeadroom = max * 1.18;
  const step = withHeadroom > 60 ? 20 : 10;
  return Math.max(20, Math.ceil(withHeadroom / step) * step);
}

export interface DisplayedSeries {
  name: string;
  idx: number;
  exiting: boolean;
}

/**
 * Keep deselected cohorts mounted through their exit animation.
 *
 * BenchmarkBarChart shrinks an exiting bar in place and only then closes the gap, which
 * needs the entry to survive the render that removed it. Without this the bar would
 * vanish instantly and the siblings would jump.
 *
 * `idx` is the palette slot, taken from the full cohort list rather than the selection —
 * so removing a cohort never repaints the ones that remain.
 */
export function useDisplayedSeries(
  selected: readonly string[],
  allCohorts: readonly string[]
): DisplayedSeries[] {
  const [displayed, setDisplayed] = useState<DisplayedSeries[]>(() =>
    selected.map((name) => ({ name, idx: cohortSlot(name, allCohorts), exiting: false }))
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setDisplayed((prev) => {
      const selectedSet = new Set(selected);
      const kept = prev
        .filter((d) => selectedSet.has(d.name) || !d.exiting || timers.current.has(d.name))
        .map((d) => ({
          ...d,
          idx: cohortSlot(d.name, allCohorts),
          exiting: !selectedSet.has(d.name),
        }));

      const known = new Set(kept.map((d) => d.name));
      const added = selected
        .filter((name) => !known.has(name))
        .map((name) => ({ name, idx: cohortSlot(name, allCohorts), exiting: false }));

      // Cancel a pending removal if the cohort came back before its window elapsed.
      for (const name of selected) {
        const timer = timers.current.get(name);
        if (timer) {
          clearTimeout(timer);
          timers.current.delete(name);
        }
      }

      const next = [...kept, ...added];
      for (const entry of next) {
        if (entry.exiting && !timers.current.has(entry.name)) {
          const timer = setTimeout(() => {
            timers.current.delete(entry.name);
            setDisplayed((cur) => cur.filter((d) => d.name !== entry.name));
          }, EXIT_MS);
          timers.current.set(entry.name, timer);
        }
      }
      return next;
    });
  }, [selected, allCohorts]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  return displayed;
}
