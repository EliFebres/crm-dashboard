'use client';

import React from 'react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { ClientBasePoint, UniquePerDeptRow } from '@/app/lib/api/kpi';
import { C, MONO } from './tokens';

const TOOLTIP_STYLE = {
  background: 'rgba(24, 24, 27, 0.95)',
  border: '1px solid #3f3f46',
  borderRadius: 6,
  fontSize: 12,
} as const;

/** Q13 evidence — monthly new vs returning clients + per-department unique counts. */
export default function ClientBaseBlock({ clientBase, uniquePerDept }: { clientBase: ClientBasePoint[]; uniquePerDept: UniquePerDeptRow[] }) {
  return (
    <div style={{ paddingTop: 6 }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 14, fontFamily: MONO }}>
        <span style={{ color: C.cyan }}>■ new</span>{'  '}
        <span style={{ color: C.textFaint }}>■ returning</span>{'  '}
        unique clients per month
      </div>
      <div style={{ height: 130 }}>
        <ClientOnlyChart>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={clientBase} margin={{ top: 4, right: 4, bottom: 0, left: 4 }} barCategoryGap="18%">
              <XAxis dataKey="label" tick={{ fill: C.textFaint, fontSize: 9, fontFamily: MONO }} axisLine={false} tickLine={false} interval={0} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: C.textSecondary }} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              {/* Returning at the bottom of the stack, new on top (matches the design). */}
              <Bar dataKey="returningN" name="Returning" stackId="a" fill={C.returning} isAnimationActive animationDuration={400} />
              <Bar dataKey="newN" name="New" stackId="a" fill={C.cyan} isAnimationActive animationDuration={400} />
            </BarChart>
          </ResponsiveContainer>
        </ClientOnlyChart>
      </div>
      <div style={{ display: 'flex', gap: 32, marginTop: 26, flexWrap: 'wrap' }}>
        {uniquePerDept.map(u => (
          <div key={u.dept}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: u.color }} />
              <span style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{u.dept}</span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 24, fontWeight: 300, color: C.textPrimary, marginTop: 4 }}>{u.unique}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
