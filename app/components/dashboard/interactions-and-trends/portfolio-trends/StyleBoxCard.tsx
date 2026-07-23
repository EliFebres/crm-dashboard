'use client';

import React, { useState } from 'react';
import type { BreakdownSeries, ModelBreakdownPoint } from '@/app/lib/types/portfolioTrends';
import { BENCHMARK_COLOR, DELTA_INK, MODEL_CLOUD_COLOR, cohortColor } from './chartTokens';

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
 *
 * The index and each cohort are directly labelled, as on the XY scatters, so identity
 * never depends on hovering or on matching a color to a legend. The model cloud is not:
 * sixty-nine names would bury the three that matter, and those points are there for their
 * distribution rather than individually.
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
  /** A single model behind the averages, not a series of its own. */
  isModel?: boolean;
  sublabel?: string;
  detail: string[];
  /**
   * Vertical offset of the direct label from the dot's centre, in pixels.
   *
   * Same arrangement as the XY scatters: cohorts stack upward, the index sits below, and
   * every label is centred on its own dot. A cohort average and the index routinely land
   * a few pixels apart — that closeness is the finding — so a shared offset would put the
   * two labels on top of each other exactly when the card is most worth reading.
   * Cloud dots are not labelled at all; sixty-nine names would bury the three that matter.
   */
  labelDy: number;
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
  /** Every model with a cap and style split — the cloud behind the averages. */
  models: ModelBreakdownPoint[];
  /** Cohorts to plot and column, in selection order. */
  cohorts: string[];
  /** Full option list — colors key off this so deselecting never repaints survivors. */
  allCohorts: readonly string[];
  benchmarkName: string;
}

export default function StyleBoxCard({
  marketCap, style, models, cohorts, allCohorts, benchmarkName,
}: Props) {
  const [hover, setHover] = useState<Dot | null>(null);

  const dots: Dot[] = [];

  // The cloud first, so every labelled mark layers over it. Same role as the model dots
  // on the XY scatters: an average sitting inside a tight cluster and the same average
  // sitting between two clusters are very different findings, and the cohort dot alone
  // cannot tell them apart.
  for (const model of models) {
    const cap = model.weights['market_cap'];
    const sty = model.weights['style'];
    const x = styleAxis(sty);
    const y = sizeAxis(cap);
    if (x == null || y == null) continue;
    dots.push({
      key: `model:${model.modelId}`,
      label: model.modelName,
      sublabel: model.clientName,
      x,
      y,
      color: MODEL_CLOUD_COLOR,
      isBenchmark: false,
      isModel: true,
      labelDy: 0, // never labelled
      detail: [
        `Large/Mid/Small: ${pct(cap?.['Large'])} / ${pct(cap?.['Mid'])} / ${pct(cap?.['Small'])}`,
        `Value/Blend/Growth: ${pct(sty?.['Value'])} / ${pct(sty?.['Blend'])} / ${pct(sty?.['Growth'])}`,
      ],
    });
  }

  // Index next, so portfolio dots layer over it.
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
      // Below the dot — the opposite side from the cohorts, which is what keeps the two
      // apart when a cohort average sits right on top of the index.
      labelDy: 18,
      detail: [
        `Large/Mid/Small: ${pct(marketCap?.benchmark?.['Large'])} / ${pct(marketCap?.benchmark?.['Mid'])} / ${pct(marketCap?.benchmark?.['Small'])}`,
        `Value/Blend/Growth: ${pct(style?.benchmark?.['Value'])} / ${pct(style?.benchmark?.['Blend'])} / ${pct(style?.benchmark?.['Growth'])}`,
      ],
    });
  }

  cohorts.forEach((cohort, i) => {
    const cap = marketCap?.cohorts[cohort];
    const sty = style?.cohorts[cohort];
    const x = styleAxis(sty);
    const y = sizeAxis(cap);
    if (x == null || y == null) return;
    const color = cohortColor(cohort, allCohorts);
    dots.push({
      key: cohort,
      label: cohort,
      x,
      y,
      color: color.hex,
      glow: color.glow,
      isBenchmark: false,
      // Clears both its own dot and the index's, then stacks for further cohorts.
      labelDy: -17 - i * 13,
      detail: [
        `Large/Mid/Small: ${pct(cap?.['Large'])} / ${pct(cap?.['Mid'])} / ${pct(cap?.['Small'])}`,
        `Value/Blend/Growth: ${pct(sty?.['Value'])} / ${pct(sty?.['Blend'])} / ${pct(sty?.['Growth'])}`,
      ],
    });
  });

  const modelDotCount = dots.filter((d) => d.isModel).length;
  const seriesFor = (dimension: 'market_cap' | 'style') => (dimension === 'market_cap' ? marketCap : style);

  return (
    <div className="grid flex-1 min-h-0 grid-cols-2 gap-4">
      {/* ---- Style box ----
          Full height of the cell, 75% of its width. Sized directly rather than through an
          aspect ratio, which coupled the two: constraining the width to the height left
          the box narrow whenever the row was short. Both axes are normalized 0..1 and
          every mark is placed in percentages, so the proportions are presentational and
          no positioning depends on them. */}
      <div className="flex min-w-0 flex-col">
        <div className="flex min-h-0 flex-1">
          <div className="flex w-12 flex-shrink-0 flex-col justify-around pr-2 text-right">
            <span className="text-sm leading-none text-muted">Large</span>
            <span className="text-sm leading-none text-muted">Mid</span>
            <span className="text-sm leading-none text-muted">Small</span>
          </div>
          <div className="relative h-full w-3/4 rounded-sm border-4 border-zinc-600/80">
            <div className="absolute left-0 right-0 border-t-[3px] border-zinc-700/70" style={{ top: '33.333%' }} />
            <div className="absolute left-0 right-0 border-t-[3px] border-zinc-700/70" style={{ top: '66.667%' }} />
            <div className="absolute bottom-0 top-0 border-l-[3px] border-zinc-700/70" style={{ left: '33.333%' }} />
            <div className="absolute bottom-0 top-0 border-l-[3px] border-zinc-700/70" style={{ left: '66.667%' }} />

            {dots.map((dot) => (
              <div
                key={dot.key}
                className={`absolute cursor-pointer rounded-full ${
                  dot.isModel ? 'z-0 h-2.5 w-2.5' : 'z-10 h-4 w-4 border-2'
                }`}
                style={{
                  left: `${dot.x * 100}%`,
                  top: `${dot.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: dot.isBenchmark ? 'transparent' : dot.color,
                  borderColor: dot.isModel ? undefined : dot.color,
                  boxShadow: dot.glow ? `0 0 14px ${dot.glow}` : undefined,
                }}
                onMouseEnter={() => setHover(dot)}
                onMouseLeave={() => setHover((h) => (h?.key === dot.key ? null : h))}
              />
            ))}

            {/* Direct labels, as on the XY scatters. Rendered after every dot so they sit
                on top, and carrying a surface-colored halo instead of a background box so
                they stay legible over the gridlines and the cloud without masking them.
                pointer-events-none keeps a label from stealing its own dot's hover. */}
            {dots.filter((d) => !d.isModel).map((dot) => (
              <span
                key={`label:${dot.key}`}
                className="pointer-events-none absolute z-20 whitespace-nowrap text-[10px] leading-none"
                style={{
                  left: `${dot.x * 100}%`,
                  top: `${dot.y * 100}%`,
                  transform: `translate(-50%, calc(-50% + ${dot.labelDy}px))`,
                  color: dot.isBenchmark ? '#a1a1aa' : '#e4e4e7',
                  textShadow:
                    '0 0 3px #131316, 0 0 3px #131316, 0 0 3px #131316, 0 0 3px #131316',
                }}
              >
                {dot.label}
              </span>
            ))}

            {hover && (
              <div
                className="pointer-events-none absolute z-20 whitespace-nowrap border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg"
                style={{
                  left: `${hover.x * 100}%`,
                  top: `${hover.y * 100}%`,
                  // Below the dot in the top third, above it everywhere else, so a
                  // tooltip near the ceiling isn't clipped by the card.
                  transform: hover.y < 0.33 ? 'translate(-50%, 40%)' : 'translate(-50%, -140%)',
                }}
              >
                <div className="text-zinc-200">{hover.label}</div>
                {hover.sublabel && (
                  <div className="mb-0.5 text-[10px] text-zinc-500">{hover.sublabel}</div>
                )}
                {hover.detail.map((line) => (
                  <div key={line} className="font-mono text-[10px] text-zinc-400">{line}</div>
                ))}
              </div>
            )}
          </div>
        </div>
        {/* Mirrors the row above — same gutter, same 75% — so the labels stay under their
            columns whatever the cell width. */}
        <div className="mt-1 flex">
          <div className="w-12 flex-shrink-0" />
          <div className="flex w-3/4">
            <span className="flex-1 text-center text-sm leading-none text-muted">Value</span>
            <span className="flex-1 text-center text-sm leading-none text-muted">Core</span>
            <span className="flex-1 text-center text-sm leading-none text-muted">Growth</span>
          </div>
        </div>
        {/* Names the faint marks, matching the scatter cards' footnote. */}
        {modelDotCount > 0 && (
          <div className="ml-12 mt-2 flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span
              className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
              style={{ background: MODEL_CLOUD_COLOR }}
            />
            {modelDotCount} model{modelDotCount === 1 ? '' : 's'}
          </div>
        )}
      </div>

      {/* ---- Allocation table ---- */}
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            {/* Same header treatment as MetricsTable: a color swatch carries identity and
                the text stays neutral ink, so the two cards read as one system. */}
            <tr className="border-b border-zinc-800">
              <th className="py-1.5 pr-2 text-left font-medium text-zinc-500">Category</th>
              {cohorts.map((cohort) => (
                <th key={cohort} className="py-1.5 px-1.5 text-right font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 flex-shrink-0"
                      style={{ background: cohortColor(cohort, allCohorts).hex }}
                    />
                    <span className="truncate text-zinc-300" title={cohort}>{cohort}</span>
                  </span>
                </th>
              ))}
              <th className="py-1.5 pl-1.5 text-right font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 flex-shrink-0"
                    style={{ background: BENCHMARK_COLOR.hex }}
                  />
                  <span className="truncate text-zinc-400" title={benchmarkName}>Index</span>
                </span>
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
                          {names != null && (
                            <span className="text-zinc-500">{names.toLocaleString()} names</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="py-1.5 pl-1.5 text-right align-top">
                    <div className="font-mono tabular-nums text-zinc-400">
                      {indexWeight == null ? '—' : `${Math.round(indexWeight * 100)}%`}
                    </div>
                    {indexNames != null && (
                      <div className="text-[10px] text-zinc-600">
                        {indexNames.toLocaleString()} names
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
          Weight over the index delta, then the number of names holding it. Growth and Value
          exclude the Blend bucket, so they do not total 100%.
        </p>
      </div>
    </div>
  );
}
