'use client';

import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Cell, LabelList, ResponsiveContainer } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { ClientDeptRow, ChainRolledRow, SpawnRateRow } from '@/app/lib/api/kpi';
import { C, MONO } from './tokens';
import { fmtCur, fmtInt } from './briefing-utils';

const catTick = { fill: '#a1a1aa', fontSize: 12 } as const;
const valueLabelStyle = { fill: '#a1a1aa', fontSize: 12, fontFamily: MONO } as const;

/** Text tab (cyan underline when active) used by the Q6 metric toggle. */
function TextTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        fontFamily: MONO,
        fontSize: 11,
        padding: '2px 0',
        color: active ? C.textPrimary : C.textMuted,
        borderBottom: `2px solid ${active ? C.cyan : 'transparent'}`,
      }}
    >
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Q6 — client department lens (Interactions / Total NNA / NNA per Interaction)
// -----------------------------------------------------------------------------

type DeptMetric = 'interactions' | 'nna' | 'avg';

export function DeptBars({ data }: { data: ClientDeptRow[] }) {
  const [metric, setMetric] = useState<DeptMetric>('interactions');
  const value = (d: ClientDeptRow) => (metric === 'interactions' ? d.interactions : metric === 'nna' ? d.nna : d.nnaPerInteraction);
  const fmt = (v: number) => (metric === 'interactions' ? fmtInt(v) : fmtCur(v));
  const rows = data.map(d => ({ dept: d.dept, value: value(d), color: d.color, valueLabel: fmt(value(d)) }));

  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 18 }}>
        <TextTab label="Interactions" active={metric === 'interactions'} onClick={() => setMetric('interactions')} />
        <TextTab label="Total NNA" active={metric === 'nna'} onClick={() => setMetric('nna')} />
        <TextTab label="NNA / Interaction" active={metric === 'avg'} onClick={() => setMetric('avg')} />
      </div>
      <div style={{ height: Math.max(120, rows.length * 40) }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={rows} margin={{ top: 0, right: 70, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="dept" width={110} tick={catTick} axisLine={false} tickLine={false} />
              <Bar dataKey="value" barSize={16} isAnimationActive animationDuration={400}>
                {rows.map(r => (
                  <Cell key={r.dept} fill={r.color} />
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
// Q12 — follow-up spawn rate by originating type
// -----------------------------------------------------------------------------

export function SpawnBars({ data }: { data: SpawnRateRow[] }) {
  const rows = data.map(s => ({ type: s.type, value: s.pct, color: s.color, valueLabel: `${Math.round(s.pct)}%` }));
  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: C.textMuted, paddingTop: 6 }}>Not enough chained work to measure spawn rate.</div>;
  }
  return (
    <div style={{ paddingTop: 6, maxWidth: 560 }}>
      <div style={{ height: Math.max(120, rows.length * 38) }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={rows} margin={{ top: 0, right: 50, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="type" width={132} tick={catTick} axisLine={false} tickLine={false} />
              <Bar dataKey="value" barSize={16} isAnimationActive animationDuration={400}>
                {rows.map(r => (
                  <Cell key={r.type} fill={r.color} />
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
// Q8 — chain-rolled NNA (direct solid + downstream faded), top 6 by rolled value
// -----------------------------------------------------------------------------

export function ChainRolledBars({ data }: { data: ChainRolledRow[] }) {
  const rows = data
    .filter(r => r.rolledNna > 0)
    .slice(0, 6)
    .map(r => ({
      type: r.type,
      directNna: r.directNna,
      downstream: r.downstream,
      color: r.color,
      endLabel: `${fmtCur(r.rolledNna)}   ${r.downstream > 0 ? `+${Math.round(r.uplift)}% downstream` : 'no downstream'}`,
    }));

  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: C.textMuted, paddingTop: 6 }}>No attributable NNA yet.</div>;
  }

  // Custom end-of-bar label pulling the rolled total + uplift text for each row.
  const EndLabel = (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) => {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const width = Number(props.width ?? 0);
    const height = Number(props.height ?? 0);
    const row = rows[props.index ?? 0];
    if (!row) return <g />;
    return (
      <text x={x + width + 8} y={y + height / 2} dy="0.35em" fontFamily={MONO} fontSize={11} fill={C.cyan}>
        {row.endLabel}
      </text>
    );
  };

  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16, fontFamily: MONO }}>
        solid = direct NNA · faded = rolled-up downstream NNA
      </div>
      <div style={{ height: Math.max(120, rows.length * 40) }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={rows} margin={{ top: 0, right: 170, bottom: 0, left: 0 }} barCategoryGap="30%">
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis type="category" dataKey="type" width={132} tick={catTick} axisLine={false} tickLine={false} />
              <Bar dataKey="directNna" stackId="nna" barSize={16} isAnimationActive animationDuration={400}>
                {rows.map(r => (
                  <Cell key={r.type} fill={r.color} />
                ))}
              </Bar>
              <Bar dataKey="downstream" stackId="nna" barSize={16} isAnimationActive animationDuration={400}>
                {rows.map(r => (
                  <Cell key={r.type} fill={r.color} fillOpacity={0.3} />
                ))}
                <LabelList content={EndLabel} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ClientOnlyChart>
      </div>
    </div>
  );
}
