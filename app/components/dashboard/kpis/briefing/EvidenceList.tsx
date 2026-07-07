'use client';

import React from 'react';
import { C, MONO } from './tokens';

export interface EvidenceRow {
  key: string;
  name: string;
  meta: string;
  /** Assigned team member(s), shown just after the meta. */
  assignee?: string;
  /** Muted text placed just before the badge (e.g. "done Jan 6, 2025"). */
  rightText?: string;
  badge: string;
  badgeColor: string;
}

/** Shared hairline-separated list used by Q5 (stale), Q10 (chase), Q14 (dormant). */
export default function EvidenceList({ rows, empty }: { rows: EvidenceRow[]; empty: string }) {
  if (rows.length === 0) {
    return <div style={{ fontSize: 13, color: C.textMuted, paddingTop: 4 }}>{empty}</div>;
  }
  return (
    <div>
      {rows.map(r => (
        <div
          key={r.key}
          style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '9px 0', borderBottom: `1px solid ${C.dividerRow}` }}
        >
          <span style={{ fontSize: 13, color: C.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
          <span style={{ fontSize: 11, color: C.textMuted, flexShrink: 0 }}>
            {r.meta}
            {r.assignee && (
              <>
                {' · '}
                <span style={{ color: C.textSecondary }}>{r.assignee}</span>
              </>
            )}
          </span>
          {r.rightText !== undefined && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted, whiteSpace: 'nowrap' }}>{r.rightText}</span>
          )}
          <span
            style={{
              marginLeft: r.rightText === undefined ? 'auto' : undefined,
              fontFamily: MONO,
              fontSize: 12,
              color: r.badgeColor,
              flexShrink: 0,
            }}
          >
            {r.badge}
          </span>
        </div>
      ))}
    </div>
  );
}
