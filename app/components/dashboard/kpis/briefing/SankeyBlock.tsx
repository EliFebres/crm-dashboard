'use client';

import React, { useState } from 'react';
import { Sankey, ResponsiveContainer, Layer, Rectangle } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { JourneySankeyData, JourneyTemplate } from '@/app/lib/api/kpi';
import { nodeColor } from '../utils';
import { C, MONO, qLabelStyle, questionStyle } from './tokens';
import { fmtCur, fmtInt } from './briefing-utils';

type SankeyNodeDatum = { name: string; kind: 'intake' | 'project' | 'outcome'; color?: string };

// --- custom node: colored rounded rect + flanking label (intake left, others right) ---
function SankeyNode({ x = 0, y = 0, width = 0, height = 0, payload }: { x?: number; y?: number; width?: number; height?: number; payload?: SankeyNodeDatum }) {
  const color = payload ? nodeColor(payload) : C.textMuted;
  const labelLeft = payload?.kind === 'intake';
  return (
    <Layer>
      <Rectangle x={x} y={y} width={width} height={height} radius={2} fill={color} fillOpacity={0.95} />
      <text
        textAnchor={labelLeft ? 'end' : 'start'}
        x={labelLeft ? x - 6 : x + width + 6}
        y={y + height / 2}
        fontSize={11}
        fill="#d4d4d8"
        dy="0.35em"
      >
        {payload?.name ?? ''}
      </text>
    </Layer>
  );
}

// --- custom link: tinted by its source node's color, cursor-following tooltip ---
interface SankeyLinkProps {
  sourceX?: number;
  sourceY?: number;
  sourceControlX?: number;
  targetControlX?: number;
  targetX?: number;
  targetY?: number;
  linkWidth?: number;
  payload?: { source?: SankeyNodeDatum; target?: SankeyNodeDatum; value?: number };
  onHover?: (e: React.MouseEvent, title: string, value: number) => void;
  onLeave?: () => void;
}
function SankeyLink({
  sourceX = 0,
  sourceY = 0,
  sourceControlX = 0,
  targetControlX = 0,
  targetX = 0,
  targetY = 0,
  linkWidth = 0,
  payload,
  onHover,
  onLeave,
}: SankeyLinkProps) {
  const src = payload?.source;
  const color = src ? nodeColor(src) : C.textFaint;
  const path = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
  return (
    <path
      d={path}
      fill="none"
      stroke={color}
      strokeOpacity={0.3}
      strokeWidth={Math.max(1, linkWidth)}
      onMouseMove={e => onHover?.(e, `${src?.name ?? ''} → ${payload?.target?.name ?? ''}`, payload?.value ?? 0)}
      onMouseLeave={onLeave}
    />
  );
}

interface Tooltip {
  x: number;
  y: number;
  title: string;
  value: number;
}

interface SankeyBlockProps {
  q: string;
  question: string;
  sankey: JourneySankeyData;
  templates: JourneyTemplate[];
}

/** Q11 evidence (full width) — intake → type → outcome Sankey with a Flow ↔ Top journeys tab. */
export default function SankeyBlock({ q, question, sankey, templates }: SankeyBlockProps) {
  const [tab, setTab] = useState<'flow' | 'table'>('flow');
  const [tt, setTt] = useState<Tooltip | null>(null);

  const onHover = (e: React.MouseEvent, title: string, value: number) => {
    setTt({ x: Math.min(e.clientX + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 240), y: e.clientY + 14, title, value });
  };
  const onLeave = () => setTt(null);

  const tab_ = (label: string, key: 'flow' | 'table') => (
    <button
      onClick={() => setTab(key)}
      style={{
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        fontFamily: MONO,
        fontSize: 11,
        padding: '2px 0',
        color: tab === key ? C.textPrimary : C.textMuted,
        borderBottom: `2px solid ${tab === key ? C.cyan : 'transparent'}`,
      }}
    >
      {label}
    </button>
  );

  const th: React.CSSProperties = {
    padding: '6px 8px',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    color: C.textMuted,
    fontWeight: 500,
    borderBottom: `1px solid ${C.paretoGrid}`,
  };
  const td: React.CSSProperties = { padding: 8, fontFamily: MONO, fontSize: 12 };

  return (
    <div style={{ padding: '44px 0 0' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 640 }}>
          <div style={qLabelStyle}>{q}</div>
          <div style={questionStyle}>{question}</div>
        </div>
        <div style={{ display: 'flex', gap: 16, paddingBottom: 6 }}>
          {tab_('Flow', 'flow')}
          {tab_('Top journeys', 'table')}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        {tab === 'flow' ? (
          sankey.links.length === 0 ? (
            <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: C.textMuted }}>
              No journey data for the current scope.
            </div>
          ) : (
            <div style={{ height: 380 }}>
              <ClientOnlyChart>
                <ResponsiveContainer width="100%" height="100%">
                  <Sankey
                    data={sankey}
                    nodePadding={28}
                    nodeWidth={12}
                    linkCurvature={0.5}
                    iterations={64}
                    node={<SankeyNode />}
                    link={<SankeyLink onHover={onHover} onLeave={onLeave} />}
                    margin={{ left: 90, right: 110, top: 10, bottom: 10 }}
                  />
                </ResponsiveContainer>
              </ClientOnlyChart>
            </div>
          )
        ) : templates.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: C.textMuted }}>No journey templates for the current scope.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left', paddingLeft: 0 }}>Journey</th>
                  <th style={{ ...th, textAlign: 'right' }}>Count</th>
                  <th style={{ ...th, textAlign: 'right' }}>Share</th>
                  <th style={{ ...th, textAlign: 'right' }}>Avg NNA</th>
                  <th style={{ ...th, textAlign: 'right', paddingRight: 0 }}>Completion</th>
                </tr>
              </thead>
              <tbody>
                {templates.map(t => (
                  <tr key={t.signature} style={{ borderBottom: `1px solid ${C.dividerRow}` }}>
                    <td style={{ ...td, paddingLeft: 0, color: C.textStrong }}>{t.signature}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#d4d4d8' }}>{fmtInt(t.count)}</td>
                    <td style={{ ...td, textAlign: 'right', color: C.textSecondary }}>{t.percentOfTotal.toFixed(1)}%</td>
                    <td style={{ ...td, textAlign: 'right', color: C.cyan }}>{fmtCur(t.avgNna)}</td>
                    <td style={{ ...td, textAlign: 'right', paddingRight: 0, color: C.completed }}>{Math.round(t.completionRate)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tt && (
        <div
          style={{
            position: 'fixed',
            zIndex: 1000,
            pointerEvents: 'none',
            background: 'rgba(24,24,27,0.95)',
            border: '1px solid #3f3f46',
            borderRadius: 6,
            padding: '7px 10px',
            fontSize: 12,
            maxWidth: 260,
            left: tt.x,
            top: tt.y,
          }}
        >
          <div style={{ color: C.textSecondary, marginBottom: 2 }}>{tt.title}</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: C.cyan }}>{fmtInt(tt.value)} engagements</div>
        </div>
      )}
    </div>
  );
}
