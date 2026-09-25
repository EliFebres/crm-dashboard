'use client';

import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, LabelList, Tooltip, ResponsiveContainer } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { TickerNnaData, TickerNnaRow } from '@/app/lib/api/kpi';
import { C, MONO, captionStyle } from './tokens';
import { fmtCur } from './briefing-utils';
import { TextTab, catTick, valueLabelStyle } from './Bars';
import { TOOLTIP_STYLE } from './Charts';

const TOP_TICKERS = 10;
const OTHER_TICKERS = 'Other tickers';
const FALLBACK_COLOR = '#71717a';

/** Top tickers, the rest folded into "Other tickers", then Unallocated last. */
function displayRows(data: TickerNnaData): TickerNnaRow[] {
  const top = data.tickers.slice(0, TOP_TICKERS);
  const rest = data.tickers.slice(TOP_TICKERS);
  const rows = [...top];
  if (rest.length) {
    const other: TickerNnaRow = { ticker: OTHER_TICKERS, nna: 0, engagements: 0, share: 0, byType: {}, byDept: {} };
    for (const r of rest) {
      other.nna += r.nna;
      other.engagements += r.engagements;
      other.share += r.share;
      for (const [k, v] of Object.entries(r.byType)) other.byType[k] = (other.byType[k] ?? 0) + v;
      for (const [k, v] of Object.entries(r.byDept)) other.byDept[k] = (other.byDept[k] ?? 0) + v;
    }
    rows.push(other);
  }
  if (data.unallocated.nna > 0) rows.push(data.unallocated);
  return rows;
}

function barColor(r: TickerNnaRow, data: TickerNnaData): string {
  if (r === data.unallocated) return FALLBACK_COLOR;
  return r.ticker === OTHER_TICKERS ? 'rgba(34,211,238,0.45)' : C.cyan;
}

// -----------------------------------------------------------------------------
// Q8 — NNA by ticker (top 10, Other tickers, Unallocated)
// -----------------------------------------------------------------------------

export function TickerNnaBars({ data }: { data: TickerNnaData }) {
  if (!data.totalNna) {
    return <div style={{ fontSize: 13, color: C.textMuted, paddingTop: 6 }}>No NNA in this period.</div>;
  }
  const rows = displayRows(data).map(r => ({
    ticker: r.ticker,
    value: r.nna,
    color: barColor(r, data),
    valueLabel: `${fmtCur(r.nna)} · ${Math.round(r.share)}%`,
  }));

  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ ...captionStyle, marginBottom: 16 }}>
        {Math.round(data.allocatedPct)}% of {fmtCur(data.totalNna)} allocated to {data.tickers.length} ticker
        {data.tickers.length === 1 ? '' : 's'} · <span style={{ color: FALLBACK_COLOR }}>grey = unallocated</span>
      </div>
      <div style={{ height: Math.max(120, rows.length * 36) }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={rows} margin={{ top: 0, right: 110, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="ticker" width={110} tick={catTick} axisLine={false} tickLine={false} />
              <Bar dataKey="value" barSize={16} isAnimationActive animationDuration={400}>
                {rows.map(r => (
                  <Cell key={r.ticker} fill={r.color} />
                ))}
                <LabelList dataKey="valueLabel" position="right" style={valueLabelStyle} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ClientOnlyChart>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Q9 — where each ticker's NNA comes from (stacked by project type / client dept)
// -----------------------------------------------------------------------------

type SourceDim = 'type' | 'dept';

export function TickerSourceBars({ data }: { data: TickerNnaData }) {
  const [dim, setDim] = useState<SourceDim>('type');

  const { rows, series } = useMemo(() => {
    const display = displayRows(data);
    const split = (r: TickerNnaRow) => (dim === 'type' ? r.byType : r.byDept);
    const colors = dim === 'type' ? data.typeColors : data.deptColors;

    // Series ordered by overall size so the largest source sits at the bar's base.
    const totals: Record<string, number> = {};
    for (const r of display) for (const [k, v] of Object.entries(split(r))) totals[k] = (totals[k] ?? 0) + v;
    // Index-based keys: source names can contain '.', which Recharts treats as a path.
    const series = Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .map(([name], i) => ({ key: `s${i}`, name: name || 'Unspecified', color: colors[name] || FALLBACK_COLOR, source: name }));

    const rows = display.map(r => {
      const row: Record<string, string | number> = { ticker: r.ticker };
      const parts = split(r);
      for (const s of series) if (parts[s.source]) row[s.key] = parts[s.source];
      return row;
    });
    return { rows, series };
  }, [data, dim]);

  if (!data.totalNna) {
    return <div style={{ fontSize: 13, color: C.textMuted, paddingTop: 6 }}>No NNA in this period.</div>;
  }

  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        <TextTab label="Project type" active={dim === 'type'} onClick={() => setDim('type')} />
        <TextTab label="Client dept" active={dim === 'dept'} onClick={() => setDim('dept')} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 11, fontFamily: MONO, color: C.textMuted, marginBottom: 14 }}>
        {series.map(s => (
          <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <div style={{ height: Math.max(120, rows.length * 36) }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={rows} margin={{ top: 0, right: 24, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="ticker" width={110} tick={catTick} axisLine={false} tickLine={false} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: C.textSecondary }}
                formatter={value => fmtCur(Number(value))}
              />
              {series.map(s => (
                <Bar key={s.key} dataKey={s.key} name={s.name} stackId="src" fill={s.color} barSize={16} isAnimationActive animationDuration={400} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ClientOnlyChart>
      </div>
    </div>
  );
}
