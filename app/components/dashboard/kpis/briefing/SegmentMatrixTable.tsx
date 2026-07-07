'use client';

import React from 'react';
import type { SegmentMatrix } from '@/app/lib/api/kpi';
import { C, MONO } from './tokens';
import { fmtCur } from './briefing-utils';

/** Q9 evidence — type × department conversion matrix (hit rate over median NNA). */
export default function SegmentMatrixTable({ matrix }: { matrix: SegmentMatrix }) {
  const thStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: '5px 6px',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: C.textMuted,
    fontWeight: 500,
    borderBottom: `1px solid ${C.paretoGrid}`,
  };

  return (
    <div style={{ paddingTop: 6, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: 'left', padding: '5px 6px 5px 0' }} />
            {matrix.depts.map(d => (
              <th key={d} style={thStyle}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.types.map(t => (
            <tr key={t}>
              <td style={{ padding: '7px 10px 7px 0', fontSize: 12, color: '#a1a1aa', whiteSpace: 'nowrap' }}>{t}</td>
              {matrix.depts.map(d => {
                const cell = matrix.cells[`${t}|${d}`];
                if (!cell) {
                  return (
                    <td key={d} style={{ padding: 2, textAlign: 'center' }}>
                      <div style={{ padding: '7px 2px', background: 'transparent' }}>
                        <div style={{ fontFamily: MONO, fontSize: 12, color: '#3f3f46' }}>—</div>
                        <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.textMuted }} />
                      </div>
                    </td>
                  );
                }
                return (
                  <td key={d} style={{ padding: 2, textAlign: 'center' }}>
                    <div style={{ padding: '7px 2px', background: `rgba(16,185,129,${((cell.hitRate / 100) * 0.9).toFixed(3)})` }}>
                      <div style={{ fontFamily: MONO, fontSize: 12, color: C.textStrong }}>{Math.round(cell.hitRate)}%</div>
                      <div style={{ fontFamily: MONO, fontSize: 9.5, color: C.textMuted }}>{cell.medianNna ? fmtCur(cell.medianNna) : '—'}</div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
