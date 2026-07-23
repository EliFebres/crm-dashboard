'use client';

import React, { useState } from 'react';
import type { BreakdownSeries } from '@/app/lib/types/portfolioTrends';
import { BENCHMARK_COLOR, DELTA_INK, cohortColor } from './chartTokens';

/**
 * The Morningstar style box, beside the allocation it is derived from.
 *
 * The box places each portfolio by two weights it already reports — where its money sits
 * on the size axis and on the value/growth axis — so one glance says "large-cap growth,
 * a little smaller and cheaper than the index" without reading a number. The table beside
 * it carries the numbers the box abstracts away, because the box can only show *position*:
 * two portfolios landing on the same square can hold very different allocations, and a
 * reader chasing that difference needs the figures, not a bigger box.
 *
 * Each cell shows the weight and, beneath it, how many names carry that weight. The count
 * is not decoration: 45% large cap across 12 names and across 400 names are different
 * portfolios, and the weight alone cannot tell them apart.
 */

/** Where a portfolio sits on the size axis. 0 = all large cap (top), 1 = all small (bottom). */
function sizeAxis(cap: Record<string, number> | undefined): number | null {
  if (!cap) return null;
  const large = cap['Large'] ?? 0;
  const mid = cap['Mid'] ?? 0;
  const small = cap['Small'] ?? 0;
  const total = large + mid + small;
  if (total <= 0) return null;
  // Mid counts half — it is the middle row, so a wholly mid-cap book lands dead centre.
  return (mid * 0.5 + small) / total;
}

/** Where a portfolio sits on the style axis. 0 = all value (left), 1 = all growth (right). */
function styleAxis(style: Record<string, number> | undefined): number | null {
  if (!style) return null;
  const value = style['Value'] ?? 0;
  const blend = style['Blend'] ?? 0;
  const growth = style['Growth'] ?? 0;
  const total = value + blend + growth;
  if (total <= 0) return null;
  return (blend * 0.5 + growth) / total;
}

interface Dot {
  key: string;
  label: string;
  x: number;
  y: number;
  color: string;
  glow?: string;
  isBenchmark: boolean;
  detail: string[];
}

const pct = (v: number | undefined) => `${Math.round((v ?? 0) * 100)}%`;

/** The five rows the table reports, and which dimension each is read from. */
const ROWS: Array<{ label: string; dimension: 'market_cap' | 'style'; bucket: string; invert?: boolean }> = [
  { label: 'Large-Cap', dimension: 'market_cap', bucket: 'Large', invert: true },
  { label: 'Mid-Cap', dimension: 'market_cap', bucket: 'Mid' },
  { label: 'Small-Cap', dimension: 'market_cap', bucket: 'Small' },
  { label: 'Growth', dimension: 'style', bucket: 'Growth' },
  { label: 'Value', dimension: 'style', bucket: 'Value' },
];

interface Props {
  marketCap: BreakdownSeries | undefined;
  style: BreakdownSeries | undefined;
  /** Cohorts to plot and column, in selection order. */
  cohorts: string[];
  /** Full option list — colors key off this so deselecting never repaints survivors. */
  allCohorts: readonly string[];
  benchmarkName: string;
}

export default function StyleBoxCard({
  marketCap, style, cohorts, allCohorts, benchmarkName,
}: Props) {
  const [hover, setHover] = useState<Dot | null>(null);

  const dots: Dot[] = [];

  // Index first, so portfolio dots layer over it.
  const indexX = styleAxis(style?.benchmark ?? undefined);
  const indexY = sizeAxis(marketCap?.benchmark ?? undefined);
  if (indexX != null && indexY != null) {
    dots.push({
      key: '__index__',
      label: benchmarkName,
      x: indexX,
      y: indexY,
      color: BENCHMARK_COLOR.hex,
      isBenchmark: true,
      detail: [
        `Large/Mid/Small: ${pct(marketCap?.benchmark?.['Large'])} / ${pct(marketCap?.benchmark?.['Mid'])} / ${pct(marketCap?.benchmark?.['Small'])}`,
        `Value/Blend/Growth: ${pct(style?.benchmark?.['Value'])} / ${pct(style?.benchmark?.['Blend'])} / ${pct(style?.benchmark?.['Growth'])}`,
      ],
    });
  }

  for (const cohort of cohorts) {
    const cap = marketCap?.cohorts[cohort];
    const sty = style?.cohorts[cohort];
    const x = styleAxis(sty);
    const y = sizeAxis(cap);
    if (x == null || y == null) continue;
    const color = cohortColor(cohort, allCohorts);
    dots.push({
      key: cohort,
      label: cohort,
      x,
      y,
      color: color.hex,
      glow: color.glow,
      isBenchmark: false,
      detail: [
        `Large/Mid/Small: ${pct(cap?.['Large'])} / ${pct(cap?.['Mid'])} / ${pct(cap?.['Small'])}`,
        `Value/Blend/Growth: ${pct(sty?.['Value'])} / ${pct(sty?.['Blend'])} / ${pct(sty?.['Growth'])}`,
      ],
    });
  }

  const seriesFor = (dimension: 'market_cap' | 'style') => (dimension === 'market_cap' ? marketCap : style);

  return (
    <div className="grid flex-1 min-h-0 grid-cols-2 gap-4">
      {/* ---- Style box ---- */}
      <div className="relative flex items-center justify-center">
        <div className="flex flex-col items-start">
          <div className="flex">
            <div className="flex w-10 flex-col justify-around pr-2 text-right" style={{ height: 200 }}>
              <span className="text-xs leading-none text-muted">Large</span>
              <span className="text-xs leading-none text-muted">Mid</span>
              <span className="text-xs leading-none text-muted">Small</span>
            </div>
            <div
              className="relative rounded-sm border-4 border-zinc-600/80"
              style={{ width: 200, height: 200 }}
            >
              <div className="absolute left-0 right-0 border-t-[3px] border-zinc-700/70" style={{ top: '33.333%' }} />
              <div className="absolute left-0 right-0 border-t-[3px] border-zinc-700/70" style={{ top: '66.667%' }} />
              <div className="absolute bottom-0 top-0 border-l-[3px] border-zinc-700/70" style={{ left: '33.333%' }} />
              <div className="absolute bottom-0 top-0 border-l-[3px] border-zinc-700/70" style={{ left: '66.667%' }} />

              {dots.map((dot) => (
                <div
                  key={dot.key}
                  className="absolute z-10 h-4 w-4 cursor-pointer rounded-full border-2"
                  style={{
                    left: `${dot.x * 100}%`,
                    top: `${dot.y * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: dot.isBenchmark ? 'transparent' : dot.color,
                    borderColor: dot.color,
                    boxShadow: dot.glow ? `0 0 14px ${dot.glow}` : undefined,
                  }}
                  onMouseEnter={() => setHover(dot)}
                  onMouseLeave={() => setHover((h) => (h?.key === dot.key ? null : h))}
                />
              ))}

              {hover && (
                <div
                  className="pointer-events-none absolute z-20 whitespace-nowrap border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg"
                  style={{
                    left: `${hover.x * 100}%`,
                    top: `${hover.y * 100}%`,
                    transform: 'translate(-50%, -140%)',
                  }}
                >
                  <div className="mb-0.5 text-zinc-200">{hover.label}</div>
                  {hover.detail.map((line) => (
                    <div key={line} className="font-mono text-[10px] text-zinc-400">{line}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="ml-10 mt-1 flex" style={{ width: 200 }}>
            <span className="flex-1 text-center text-xs leading-none text-muted">Value</span>
            <span className="flex-1 text-center text-xs leading-none text-muted">Core</span>
            <span className="flex-1 text-center text-xs leading-none text-muted">Growth</span>
          </div>
        </div>
      </div>

      {/* ---- Allocation table ---- */}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-700/60">
              <th className="py-1.5 pr-2 text-left font-normal text-muted">Category</th>
              {cohorts.map((cohort) => (
                <th key={cohort} className="py-1.5 px-1.5 text-right font-medium">
                  <span
                    className="block truncate"
                    style={{ color: cohortColor(cohort, allCohorts).hex }}
                    title={cohort}
                  >
                    {cohort}
                  </span>
                </th>
              ))}
              <th className="py-1.5 pl-1.5 text-right font-medium" title={benchmarkName}>
                <span style={{ color: BENCHMARK_COLOR.hex }}>Index</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const series = seriesFor(row.dimension);
              const indexWeight = series?.benchmark?.[row.bucket];
              const indexNames = series?.benchmarkNames?.[row.bucket];
              return (
                <tr key={row.label} className="border-b border-zinc-800/40 last:border-0">
                  <td className="py-1.5 pr-2 font-medium text-white">{row.label}</td>
                  {cohorts.map((cohort) => {
                    const weight = series?.cohorts[cohort]?.[row.bucket];
                    const names = series?.cohortNames[cohort]?.[row.bucket];
                    const delta =
                      weight != null && indexWeight != null ? (weight - indexWeight) * 100 : null;
                    // Large-cap is inverted: less mega-cap concentration reads as the
                    // favourable direction, matching how the metrics card treats it.
                    const favorable = delta == null ? null : row.invert ? delta < 0 : delta > 0;
                    return (
                      <td key={cohort} className="py-1.5 px-1.5 text-right align-top">
                        <div className="font-mono tabular-nums text-white">
                          {weight == null ? '—' : `${Math.round(weight * 100)}%`}
                        </div>
                        <div className="flex items-center justify-end gap-1.5 text-[10px]">
                          {delta != null && Math.abs(delta) >= 0.5 && (
                            <span
                              className="font-mono tabular-nums"
                              style={{ color: favorable ? DELTA_INK.up : DELTA_INK.down }}
                            >
                              {delta > 0 ? '+' : ''}{Math.round(delta)}
                            </span>
                          )}
                          {names != null && <span className="text-zinc-500">{names.toLocaleString()}n</span>}
                        </div>
                      </td>
                    );
                  })}
                  <td className="py-1.5 pl-1.5 text-right align-top">
                    <div className="font-mono tabular-nums text-zinc-400">
                      {indexWeight == null ? '—' : `${Math.round(indexWeight * 100)}%`}
                    </div>
                    {indexNames != null && (
                      <div className="text-[10px] text-zinc-600">{indexNames.toLocaleString()}n</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
          Weight over the index delta; <span className="text-zinc-500">n</span> is the number of
          names holding it. Growth and Value exclude the Blend bucket, so they do not total 100%.
        </p>
      </div>
    </div>
  );
}
