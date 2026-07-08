'use client';

import React from 'react';
import type { CycleTimeRow } from '@/app/lib/api/kpi';
import { C, MONO } from './tokens';

/** Q4 evidence — dumbbell rows: median dot → P90 tick per project type, scaled to max P90. */
export default function CycleDumbbell({ data }: { data: CycleTimeRow[] }) {
  const max = Math.max(1, ...data.map(c => c.p90));
  const pct = (v: number) => `${((v / max) * 96).toFixed(1)}%`;

  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 16, fontFamily: MONO }}>
        median <span style={{ color: C.cyan }}>●</span> to P90 <span style={{ color: C.textMuted }}>|</span> days, completed work
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.map(c => (
          <div key={c.type} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 132, flexShrink: 0, textAlign: 'right', fontSize: 12, color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {c.type}
            </div>
            <div style={{ flex: 1, position: 'relative', height: 14 }}>
              <div style={{ position: 'absolute', top: 6.5, left: 0, right: 0, height: 1, background: C.gridline }} />
              <div style={{ position: 'absolute', top: 6.5, height: 1, background: '#3f3f46', left: pct(c.median), width: `${(((c.p90 - c.median) / max) * 96).toFixed(1)}%` }} />
              <div style={{ position: 'absolute', top: 3, width: 8, height: 8, borderRadius: '50%', background: C.cyan, marginLeft: -4, left: pct(c.median) }} />
              <div style={{ position: 'absolute', top: 2, width: 1.5, height: 10, background: C.textMuted, left: pct(c.p90) }} />
            </div>
            <div style={{ width: 116, flexShrink: 0, fontFamily: MONO, fontSize: 11, color: C.textSecondary, whiteSpace: 'nowrap' }}>
              {Math.round(c.median)}d · P90 {Math.round(c.p90)}d
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
