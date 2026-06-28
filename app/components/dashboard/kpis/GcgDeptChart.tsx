'use client';

import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, LabelList, Tooltip } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { GcgDeptRow } from '@/app/lib/api/kpi';
import { GCG_DEPT_COLOR, formatCurrency, formatNumber, KPI_COLORS } from './utils';

type Metric = 'interactions' | 'nna' | 'nnaPerInteraction';

const METRIC_LABEL: Record<Metric, string> = {
  interactions: 'Interactions',
  nna: 'Total NNA',
  nnaPerInteraction: 'NNA / Interaction',
};

export default function GcgDeptChart({ data }: { data: GcgDeptRow[] }) {
  const [metric, setMetric] = useState<Metric>('interactions');

  const chartData = data.map(r => ({
    name: r.dept,
    value: r[metric],
    color: GCG_DEPT_COLOR[r.dept] ?? KPI_COLORS.zinc,
  }));

  const formatValue = (v: number | undefined) =>
    metric === 'interactions' ? formatNumber(Number(v ?? 0)) : formatCurrency(Number(v ?? 0));

  return (
    <div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white text-base font-semibold">GCG Department Lens</h3>
          <p className="text-xs text-muted">Who drives our volume and NNA</p>
        </div>
        <div className="flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 p-0.5 rounded-md">
          {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-all ${
                metric === m ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white' : 'text-muted hover:text-white'
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-[180px]">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted">No data.</div>
        ) : (
          <ClientOnlyChart>
            <ResponsiveContainer width="100%" height="100%" minHeight={180}>
              <BarChart data={chartData} layout="vertical" barSize={22} margin={{ top: 0, right: 48, bottom: 0, left: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#a1a1aa', fontSize: 11 }} width={120} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                  contentStyle={{ background: 'rgba(24, 24, 27, 0.95)', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }}
                  formatter={(v) => [formatValue(v as number | undefined), METRIC_LABEL[metric]] as [string, string]}
                />
                <Bar dataKey="value" isAnimationActive animationDuration={500}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  <LabelList
                    dataKey="value"
                    position="right"
                    formatter={((v: unknown) => formatValue(Number(v))) as never}
                    style={{ fill: '#a1a1aa', fontSize: 11 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ClientOnlyChart>
        )}
      </div>
    </div>
  );
}
