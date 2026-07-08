'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { HotTicker } from '@/app/lib/types/trends';
import {
  type Department,
  qSeries, trendN, reqOf, typePalette, trendChipStyle, edgeParts, isNoEquiv,
} from './compute';
import { Sparkline } from './charts';

const STANCE_OPTIONS = ['Replacement', 'Challenging', 'Complement'];

const th: CSSProperties = {
  textAlign: 'left', fontSize: '10px', fontWeight: 600, color: '#71717a', textTransform: 'uppercase',
  letterSpacing: '0.07em', padding: '10px 14px', borderBottom: '1px solid rgba(39,39,42,0.5)', whiteSpace: 'nowrap',
  // Sticky column headers so they stay visible while the body scrolls. Opaque
  // background covers the rows scrolling underneath.
  position: 'sticky', top: 0, zIndex: 1, background: '#17171a',
};
const tdBase: CSSProperties = {
  padding: '8px 14px', verticalAlign: 'middle', borderBottom: '1px solid rgba(39,39,42,0.4)',
};

function ChevronDownSvg({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ width: 13, height: 13, display: 'block', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

interface HotTickersTableProps {
  rows: HotTicker[];
  maxReq: number;
  department: Department;
  selectedTicker: string;
  onSelect: (ticker: string) => void;
  openStanceRank: number | null;
  onToggleStance: (rank: number) => void;
  onSetStance: (rank: number, type: string) => void;
  pageTitle: string;
  tableCaption: string;
  reqHeader: string;
  tbodyRef: React.Ref<HTMLTableSectionElement>;
}

export default function HotTickersTable({
  rows, maxReq, department, selectedTicker, onSelect,
  openStanceRank, onToggleStance, onSetStance,
  pageTitle, tableCaption, reqHeader, tbodyRef,
}: HotTickersTableProps) {
  const [hoveredRank, setHoveredRank] = useState<number | null>(null);

  return (
    <div style={{ flex: 1, minWidth: 0, background: 'rgba(24,24,27,0.6)', border: '1px solid rgba(39,39,42,0.5)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 1, background: 'linear-gradient(to right,transparent,rgba(255,255,255,0.1),transparent)' }} />

      {/* Panel header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(39,39,42,0.5)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>{pageTitle}</div>
          <div style={{ fontSize: '11px', color: '#a5a5b2', marginTop: 2 }}>{tableCaption}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: '11px', color: '#a5a5b2', display: 'flex', gap: 14 }}>
            <span><span style={{ color: '#22d3ee' }}>■</span> Competitor</span>
            <span><span style={{ color: '#fbbf24' }}>■</span> Firm</span>
          </div>
          <button className="flex items-center gap-1.5 text-[12px] text-muted hover:text-cyan-400 transition-colors" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Table body scrolls vertically within the fixed-height panel; the sticky
          thead keeps the column headers pinned while the rows scroll. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>#</th>
            <th style={th}>Ticker</th>
            <th style={th}>Trend</th>
            <th style={th}>{reqHeader}</th>
            <th style={th}>Stance</th>
            <th style={th}>Firm alt</th>
            <th style={th}>Firm edge</th>
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {rows.map((t, i) => {
            const isSel = t.ticker === selectedTicker;
            const isHover = hoveredRank === t.rank && !isSel;
            const p = typePalette(t.type);
            const menuOpen = openStanceRank === t.rank;
            const edge = edgeParts(t);
            const req = reqOf(t, department);
            const series = qSeries(t);
            const tn = trendN(t);
            const rowBg = isSel ? 'rgba(34,211,238,0.06)' : (isHover ? 'rgba(255,255,255,0.03)' : 'transparent');
            return (
              <tr
                key={t.rank}
                onClick={() => onSelect(t.ticker)}
                onMouseEnter={() => setHoveredRank(t.rank)}
                onMouseLeave={() => setHoveredRank((r) => (r === t.rank ? null : r))}
                style={{ cursor: 'pointer', background: rowBg, boxShadow: isSel ? 'inset 2px 0 0 #22d3ee' : 'none' }}
              >
                <td style={tdBase}><span style={{ fontSize: '12px', color: '#71717a' }}>{i + 1}</span></td>
                <td style={tdBase}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#22d3ee' }}>{t.ticker}</div>
                  <div style={{ fontSize: '12px', color: '#a5a5b2' }}>{t.name}</div>
                </td>
                <td style={tdBase}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkline vals={series} w={56} h={20} color={tn >= 0 ? '#34d399' : '#f87171'} />
                    <span style={trendChipStyle(tn)}>{t.trend}</span>
                  </div>
                </td>
                <td style={tdBase}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#e4e4e7' }}>{req}</div>
                  <div style={{ width: 90, height: 3, background: 'rgba(34,211,238,0.12)', marginTop: 4 }}>
                    <div style={{ height: '100%', background: '#22d3ee', width: Math.round((req / maxReq) * 100) + '%' }} />
                  </div>
                </td>
                <td data-dropdown style={{ ...tdBase, position: 'relative' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleStance(t.rank); }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', fontSize: '11px', fontWeight: 700,
                      cursor: 'pointer', whiteSpace: 'nowrap', background: p.bg, color: p.fg, border: '1px solid ' + p.bd,
                    }}
                  >
                    <span>{t.type}</span>
                    <ChevronDownSvg open={menuOpen} />
                  </button>
                  {menuOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 14, marginTop: 4, background: '#27272a', border: '1px solid #3f3f46', boxShadow: '0 12px 32px rgba(0,0,0,0.5)', minWidth: 130, zIndex: 50, padding: 4 }}>
                      {STANCE_OPTIONS.map((tp) => {
                        const active = tp === t.type;
                        return (
                          <button
                            key={tp}
                            onClick={(e) => { e.stopPropagation(); onSetStance(t.rank, tp); }}
                            className={active ? '' : 'hover:bg-[rgba(63,63,70,0.5)]'}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left', padding: '7px 12px', fontSize: '13px',
                              border: 'none', cursor: 'pointer',
                              background: active ? 'rgba(34,211,238,0.2)' : 'transparent',
                              color: active ? '#22d3ee' : '#a5a5b2',
                            }}
                          >
                            {tp}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {isNoEquiv(t) && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.08em', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)', padding: '1px 5px', whiteSpace: 'nowrap' }}>
                        NO DIRECT EQUIV
                      </span>
                    </div>
                  )}
                </td>
                <td style={tdBase}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#fbbf24' }}>{t.firmCompetitor}</div>
                  <div style={{ fontSize: '12px', color: '#a5a5b2' }}>{t.firmName}</div>
                </td>
                <td style={tdBase}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={edge.badge}>{edge.label}</span>
                    <span style={edge.scoreStyle}>{edge.scoreText}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#a5a5b2', whiteSpace: 'nowrap', marginTop: 3 }}>{edge.sub}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
