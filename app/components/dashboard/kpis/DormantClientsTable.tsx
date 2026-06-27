'use client';

import React from 'react';
import { MoonStar } from 'lucide-react';
import type { DormantClient } from '@/app/lib/api/kpi';

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DormantClientsTable({ data }: { data: DormantClient[] }) {
  return (
    <div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl h-full flex flex-col">
      <div className="mb-3 flex items-center gap-2">
        <MoonStar className="w-4 h-4 text-violet-400" />
        <div>
          <h3 className="text-white text-base font-semibold">Dormant GCG Contacts</h3>
          <p className="text-xs text-muted">Clients we used to work with a lot · gone quiet for 60+ days</p>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted">
          No dormant clients — everyone we&apos;ve worked with is still active.
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[280px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-zinc-800">
                <th className="py-2 pr-2">Client · Dept</th>
                <th className="py-2 pr-2 text-center">History</th>
                <th className="py-2 pr-2 text-center">Last Seen</th>
                <th className="py-2 text-center">Days Silent</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.clientName} className="border-b border-zinc-800/50 hover:bg-white/[0.02] transition-colors">
                  <td className="py-2 pr-2">
                    <div className="text-zinc-200 truncate max-w-[200px]">{r.clientName}</div>
                    <div className="text-[10px] text-muted">{r.gcgDept}</div>
                  </td>
                  <td className="py-2 pr-2 text-center text-muted font-mono">{r.historicalCount}×</td>
                  <td className="py-2 pr-2 text-center text-xs text-muted">{formatDate(r.lastEngagedDate)}</td>
                  <td className="py-2 text-center">
                    <span className="text-xs font-mono text-violet-400">{r.daysSinceLast}d</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
