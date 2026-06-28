'use client';

import React from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { NnaConcentration } from '@/app/lib/api/kpi';
import { KPI_COLORS, formatCurrency } from './utils';

export default function NnaConcentrationCard({ data }: { data: NnaConcentration }) {
  const chartData = data.clients.map(c => ({
    rank: c.rank,
    cumulative: c.cumulativeShare,
    name: c.clientName,
  }));

  return (
    <div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl h-full flex flex-col">
      <div className="mb-3">
        <h3 className="text-white text-base font-semibold">NNA Concentration</h3>
        <p className="text-xs text-muted">
          {data.clients.length > 0
            ? `Top ${data.clientsForEightyPercent} clients = 80% of NNA · Top 5 share ${data.top5Share.toFixed(0)}%`
            : 'No NNA data yet.'}
        </p>
      </div>

      {chartData.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted">No NNA data.</div>
      ) : (
        <>
          <div className="h-[140px] mb-3">
            <ClientOnlyChart>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="2 3" />
                  <XAxis dataKey="rank" tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
                  <ReferenceLine y={80} stroke={KPI_COLORS.amber} strokeDasharray="3 3" strokeOpacity={0.6} />
                  <Tooltip
                    contentStyle={{ background: 'rgba(24, 24, 27, 0.95)', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }}
                    formatter={(v) => [`${Number(v ?? 0).toFixed(0)}% cumulative`, 'Share'] as [string, string]}
                    labelFormatter={(rank) => `Client #${rank}`}
                  />
                  <Line type="monotone" dataKey="cumulative" stroke={KPI_COLORS.cyan} strokeWidth={2} dot={{ r: 3, fill: KPI_COLORS.cyan }} isAnimationActive animationDuration={500} />
                </LineChart>
              </ResponsiveContainer>
            </ClientOnlyChart>
          </div>
          <div className="space-y-1 max-h-[140px] overflow-y-auto pr-1">
            {data.clients.slice(0, 5).map((c) => (
              <div key={`${c.rank}-${c.clientName}`} className="flex items-center justify-between text-xs py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted font-mono w-4">#{c.rank}</span>
                  <span className="text-zinc-200 truncate">{c.clientName}</span>
                  <span className="text-[10px] text-muted px-1.5 py-0.5 bg-zinc-800/60 rounded">{c.gcgDept}</span>
                </div>
                <span className="text-cyan-400 font-mono flex-shrink-0 ml-2">{formatCurrency(c.nna)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
