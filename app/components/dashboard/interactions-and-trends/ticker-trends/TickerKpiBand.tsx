'use client';

import React from 'react';
import type { CSSProperties } from 'react';
import type { HotTicker } from '@/app/lib/types/trends';
import {
  type Department,
  avgQoq, reqOf, trendN, isNoEquiv, trendChipStyle, devBadgeStyle,
} from './compute';

interface Kpi {
  label: string;
  value: string;
  valStyle: CSSProperties;
  chip?: string;
  chipStyle?: CSSProperties;
  sub: string;
}

const bigVal: CSSProperties = { fontSize: '22px', fontWeight: 700, color: '#fff' };
const redChip: CSSProperties = {
  display: 'inline-block', padding: '2px 7px', fontSize: '11px', fontWeight: 700,
  background: 'rgba(239,68,68,0.14)', color: '#f87171',
};
const labelStyle: CSSProperties = {
  fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', color: '#71717a', textTransform: 'uppercase',
};

export default function TickerKpiBand({ tickers, department }: { tickers: HotTicker[]; department: Department }) {
  const D = tickers;
  const N = D.length;
  const deptSel = department !== 'All Departments';
  const totalView = D.reduce((a, t) => a + reqOf(t, department), 0);
  const avg = avgQoq(D);
  const tpN = D.filter((t) => t.talkingPointsUrl).length;
  const pcrN = D.filter((t) => t.pcrUrl).length;
  const nN = D.filter((t) => t.noteEntries.length > 0).length;
  const fullN = D.filter((t) => t.talkingPointsUrl && t.pcrUrl && t.noteEntries.length > 0).length;

  const byTrend = [...D].sort((a, b) => trendN(b) - trendN(a));
  const mover = byTrend[0];
  const cooler = byTrend[byTrend.length - 1];
  const noEq = D.filter(isNoEquiv);

  const kpis: Kpi[] = [
    {
      label: deptSel ? `${department} requests` : 'Total requests',
      value: String(totalView),
      valStyle: bigVal,
      chip: `${avg > 0 ? '+' : ''}${avg}% avg QoQ`,
      chipStyle: devBadgeStyle(avg),
      sub: deptSel ? `across the top ${N} in this team` : `across the top ${N} · all teams`,
    },
    {
      label: 'Top mover',
      value: mover?.ticker ?? '—',
      valStyle: { ...bigVal, color: '#22d3ee' },
      chip: mover?.trend,
      chipStyle: mover ? trendChipStyle(trendN(mover)) : undefined,
      sub: 'fastest-accelerating demand this period',
    },
    {
      label: 'Fastest cooling',
      value: cooler?.ticker ?? '—',
      valStyle: { ...bigVal, color: '#22d3ee' },
      chip: cooler?.trend,
      chipStyle: cooler ? trendChipStyle(trendN(cooler)) : undefined,
      sub: 'demand decelerating fastest this period',
    },
    {
      label: 'No firm answer',
      value: String(noEq.length),
      valStyle: { ...bigVal, color: '#f87171' },
      chip: noEq.map((t) => t.ticker).join(', '),
      chipStyle: redChip,
      sub: `hot ${noEq.length === 1 ? 'ticker' : 'tickers'} with no direct firm equivalent`,
    },
    {
      label: 'Enablement coverage',
      value: `${fullN}/${N}`,
      valStyle: bigVal,
      sub: `fully documented · TP ${tpN} · PCR ${pcrN} · Notes ${nN}`,
    },
  ];

  return (
    <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
      {kpis.map((k) => (
        <div key={k.label} style={{ background: 'rgba(24,24,27,0.6)', border: '1px solid rgba(39,39,42,0.5)', padding: '14px 16px' }}>
          <div style={labelStyle}>{k.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '6px' }}>
            <span style={k.valStyle}>{k.value}</span>
            {k.chip ? <span style={k.chipStyle}>{k.chip}</span> : null}
          </div>
          <div style={{ fontSize: '11px', color: '#a5a5b2', marginTop: '4px' }}>{k.sub}</div>
        </div>
      ))}
    </div>
  );
}
