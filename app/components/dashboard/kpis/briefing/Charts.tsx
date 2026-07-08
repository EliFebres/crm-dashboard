'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { WeeklyFlowPoint, MixDriftPoint, NnaConcentration } from '@/app/lib/api/kpi';
import { C, MONO } from './tokens';
import { fmtCur } from './briefing-utils';

const TOOLTIP_STYLE = {
  background: 'rgba(24, 24, 27, 0.95)',
  border: '1px solid #3f3f46',
  borderRadius: 6,
  fontSize: 12,
} as const;

const axisTick = { fill: C.textFaint, fontSize: 9, fontFamily: MONO } as const;

/** Small mono legend line shown above a chart. */
function ChartLegend({ items, note }: { items: { color: string; label: string }[]; note: string }) {
  return (
    <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 10, fontFamily: MONO }}>
      {items.map((it, i) => (
        <React.Fragment key={it.label}>
          <span style={{ color: it.color }}>— {it.label}</span>
          {i < items.length - 1 ? '  ' : ''}
        </React.Fragment>
      ))}
      <span>{'  '}{note}</span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Q2 — opened vs completed, weekly (26w)
// -----------------------------------------------------------------------------

export function WeeklyFlowChart({ data }: { data: WeeklyFlowPoint[] }) {
  return (
    <>
      <ChartLegend items={[{ color: C.cyan, label: 'opened' }, { color: C.completed, label: 'completed' }]} note="weekly, 26w" />
      <div style={{ height: 170 }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={C.gridline} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: C.textSecondary }} />
              <Line type="monotone" dataKey="opened" name="Opened" stroke={C.cyan} strokeWidth={1.5} dot={false} isAnimationActive animationDuration={500} />
              <Line type="monotone" dataKey="completed" name="Completed" stroke={C.completed} strokeWidth={1.5} dot={false} isAnimationActive animationDuration={500} />
            </LineChart>
          </ResponsiveContainer>
        </ClientOnlyChart>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Q3 — high-touch vs data-task share of monthly volume (12m)
// -----------------------------------------------------------------------------

export function MixDriftChart({ data }: { data: MixDriftPoint[] }) {
  return (
    <>
      <ChartLegend items={[{ color: C.cyan, label: 'high-touch' }, { color: C.dataTask, label: 'data tasks' }]} note="share of monthly volume, 12m" />
      <div style={{ height: 170 }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke={C.gridline} strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={1} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={v => `${v}%`} tick={axisTick} axisLine={false} tickLine={false} width={34} />
              <ReferenceLine y={50} stroke={C.gridline} strokeDasharray="2 4" />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: C.textSecondary }}
                formatter={(value, name) => [`${Math.round(Number(value))}%`, name]}
              />
              <Line type="monotone" dataKey="highPct" name="High-touch" stroke={C.cyan} strokeWidth={1.5} dot={false} isAnimationActive animationDuration={500} />
              <Line type="monotone" dataKey="lowPct" name="Data tasks" stroke={C.dataTask} strokeWidth={1.5} dot={false} isAnimationActive animationDuration={500} />
            </LineChart>
          </ResponsiveContainer>
        </ClientOnlyChart>
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Q7 — NNA concentration Pareto (cumulative share over top-15 clients) + top-5 list
// -----------------------------------------------------------------------------

export function ParetoBlock({ data }: { data: NnaConcentration }) {
  const chartData = data.clients.map(c => ({ rank: c.rank, cumulative: c.cumulativeShare, name: c.clientName }));

  if (chartData.length === 0) {
    return <div style={{ fontSize: 13, color: C.textMuted }}>No NNA data yet.</div>;
  }

  return (
    <>
      <div style={{ height: 150 }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 6, right: 10, bottom: 0, left: -6 }}>
              <CartesianGrid stroke={C.paretoGrid} strokeDasharray="2 3" vertical={false} />
              <XAxis dataKey="rank" tick={{ fill: C.axis, fontSize: 10, fontFamily: MONO }} axisLine={false} tickLine={false} interval={0} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`} tick={{ fill: C.axis, fontSize: 10, fontFamily: MONO }} axisLine={false} tickLine={false} width={38} />
              <ReferenceLine y={80} stroke={C.paretoRef} strokeDasharray="3 3" strokeOpacity={0.6} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: C.textSecondary }}
                formatter={(value) => [`${Math.round(Number(value))}% cumulative`, 'Share']}
                labelFormatter={rank => `Client #${rank}`}
              />
              <Line type="monotone" dataKey="cumulative" stroke={C.cyan} strokeWidth={2} dot={{ r: 3, fill: C.cyan }} isAnimationActive animationDuration={500} />
            </LineChart>
          </ResponsiveContainer>
        </ClientOnlyChart>
      </div>
      <div style={{ marginTop: 14, maxWidth: 560 }}>
        {data.clients.slice(0, 5).map(c => (
          <div
            key={`${c.rank}-${c.clientName}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px solid ${C.dividerRow}` }}
          >
            <span style={{ width: 20, flexShrink: 0, fontSize: 11, color: C.textMuted, fontFamily: MONO }}>#{c.rank}</span>
            <span style={{ fontSize: 13, color: C.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.clientName}</span>
            <span style={{ fontSize: 10, color: C.textSecondary, padding: '1px 6px', background: 'rgba(39,39,42,0.6)', borderRadius: 4, flexShrink: 0 }}>{c.clientDept}</span>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: C.cyan, fontFamily: MONO }}>{fmtCur(c.nna)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
