'use client';

import React from 'react';
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import { QUARTERS, qSeries } from './compute';
import type { HotTicker } from '@/app/lib/types/trends';

// ── Sparkline (56×20 request series) ─────────────────────────────────────────
// Kept as raw SVG — it's a tiny inline glyph inside a table cell, not a full chart.

export function Sparkline({ vals, w = 56, h = 20, color }: { vals: number[]; w?: number; h?: number; color: string }) {
  const max = Math.max(...vals), min = Math.min(...vals), rng = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - 2 - ((v - min) / rng) * (h - 4)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h, display: 'block', flexShrink: 0 }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ── Momentum combo chart (Recharts) ──────────────────────────────────────────
// Competitor request bars (last quarter highlighted) + a least-squares trend line.

interface MomentumDatum {
  quarter: string;
  short: string;
  requests: number;
  trend: number;
}

/** Trailing rolling (moving) average over the request series. */
function rollingAverage(vals: number[], window = 3): number[] {
  return vals.map((_, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = vals.slice(start, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

interface TooltipEntry { dataKey?: string | number; value?: number | string }
function MomentumTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const req = payload.find((p) => p.dataKey === 'requests');
  return (
    <div style={{ background: '#18181b', border: '1px solid #3f3f46', padding: '6px 10px', fontSize: 12 }}>
      <div style={{ color: '#e4e4e7', marginBottom: 2 }}>{label}</div>
      <div style={{ color: '#22d3ee', fontWeight: 700 }}>{req?.value} requests</div>
    </div>
  );
}

export function MomentumChart({ ticker }: { ticker: HotTicker }) {
  const q = qSeries(ticker);
  const trend = rollingAverage(q);
  const data: MomentumDatum[] = QUARTERS.map((quarter, i) => ({
    quarter,
    short: quarter.replace(/ 20/, ' '),
    requests: q[i] ?? 0,
    trend: trend[i] ?? 0,
  }));
  const last = data.length - 1;

  return (
    <ClientOnlyChart>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }} barCategoryGap="15%">
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 3" />
          <XAxis
            dataKey="short"
            interval={1}
            tick={{ fill: '#71717a', fontSize: 8.5, fontFamily: 'Arial' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis hide domain={[0, (max: number) => max * 1.1]} />
          <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} content={<MomentumTooltip />} />
          <Bar dataKey="requests" isAnimationActive animationDuration={600}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === last ? '#06b6d4' : 'rgba(34,211,238,0.45)'} />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="trend"
            stroke="#fbbf24"
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ClientOnlyChart>
  );
}
