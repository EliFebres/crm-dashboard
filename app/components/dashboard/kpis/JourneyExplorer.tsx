'use client';

import React, { useState } from 'react';
import { Sankey, ResponsiveContainer, Tooltip, Layer, Rectangle } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { JourneySankeyData, JourneyTemplate } from '@/app/lib/api/kpi';
import { formatCurrency, formatNumber, nodeColor } from './utils';

interface JourneyExplorerProps {
  sankey: JourneySankeyData;
  templates: JourneyTemplate[];
}

type TabKey = 'flow' | 'templates';

// Custom node renderer — adds label next to the rectangle
type SankeyNode = { name: string; kind: 'intake' | 'project' | 'outcome'; x: number; y: number; dx: number; dy: number };
interface SankeyNodeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: SankeyNode;
}
function RechartsNode({ x = 0, y = 0, width = 0, height = 0, payload }: SankeyNodeProps) {
  const color = payload ? nodeColor(payload) : '#71717a';
  const name = payload?.name ?? '';
  // Intake labels render outside-left of the rectangle; project/outcome render
  // outside-right. The `kind` field is authoritative — don't rely on x/width
  // against containerWidth, which won't flip labels reliably.
  const labelLeft = payload?.kind === 'intake';
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.9} />
      <text
        textAnchor={labelLeft ? 'end' : 'start'}
        x={labelLeft ? x - 6 : x + width + 6}
        y={y + height / 2}
        fontSize={11}
        fill="#d4d4d8"
        dy="0.35em"
      >
        {name}
      </text>
    </Layer>
  );
}

function SankeyTooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload?: Record<string, unknown> }> }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0]?.payload ?? {};
  const sourceNode = d.source as { name?: string } | undefined;
  const targetNode = d.target as { name?: string } | undefined;
  const isLink = sourceNode && targetNode && typeof d.value === 'number';
  return (
    <div className="px-3 py-2 bg-zinc-900/95 border border-zinc-700 rounded-md text-xs text-zinc-200">
      {isLink ? (
        <>
          <div className="text-muted">{sourceNode?.name} → {targetNode?.name}</div>
          <div className="font-mono text-cyan-400">{formatNumber(d.value as number)} engagements</div>
        </>
      ) : (
        <div className="text-zinc-200">{String((d as { name?: string }).name ?? '')}</div>
      )}
    </div>
  );
}

export default function JourneyExplorer({ sankey, templates }: JourneyExplorerProps) {
  const [tab, setTab] = useState<TabKey>('flow');

  return (
    <div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white text-base font-semibold">Journey Explorer</h3>
          <p className="text-xs text-muted">Intake path → project type → outcome</p>
        </div>
        <div className="flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 p-1 rounded-lg">
          <button
            onClick={() => setTab('flow')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              tab === 'flow' ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white' : 'text-muted hover:text-white'
            }`}
          >
            Flow
          </button>
          <button
            onClick={() => setTab('templates')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              tab === 'templates' ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white' : 'text-muted hover:text-white'
            }`}
          >
            Top Journeys
          </button>
        </div>
      </div>

      {tab === 'flow' ? (
        <div className="h-[420px]">
          {sankey.links.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted">
              No journey data for the current filters.
            </div>
          ) : (
            <ClientOnlyChart>
              <ResponsiveContainer width="100%" height="100%">
                <Sankey
                  data={sankey}
                  nodePadding={28}
                  nodeWidth={12}
                  linkCurvature={0.5}
                  iterations={64}
                  node={<RechartsNode />}
                  link={{ stroke: '#52525b', strokeOpacity: 0.25 }}
                  margin={{ left: 90, right: 110, top: 10, bottom: 10 }}
                >
                  <Tooltip content={<SankeyTooltipContent />} />
                </Sankey>
              </ResponsiveContainer>
            </ClientOnlyChart>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          {templates.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              No journey templates for the current filters.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted border-b border-zinc-800">
                  <th className="py-2 pr-4">Journey</th>
                  <th className="py-2 pr-4 text-right">Count</th>
                  <th className="py-2 pr-4 text-right">Share</th>
                  <th className="py-2 pr-4 text-right">Avg NNA</th>
                  <th className="py-2 pr-4 text-right">Avg Days</th>
                  <th className="py-2 pr-4 text-right">Completion</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.signature} className="border-b border-zinc-800/50 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 pr-4 text-zinc-200 font-mono text-[12px]">{t.signature}</td>
                    <td className="py-2 pr-4 text-right text-zinc-200 font-mono">{formatNumber(t.count)}</td>
                    <td className="py-2 pr-4 text-right text-muted font-mono">{t.percentOfTotal.toFixed(1)}%</td>
                    <td className="py-2 pr-4 text-right text-cyan-400 font-mono">{formatCurrency(t.avgNna)}</td>
                    <td className="py-2 pr-4 text-right text-muted font-mono">{t.avgDays ?? '—'}</td>
                    <td className="py-2 pr-4 text-right text-emerald-400 font-mono">{t.completionRate.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
