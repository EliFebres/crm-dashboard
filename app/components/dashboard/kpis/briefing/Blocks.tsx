'use client';

import React, { type ReactNode } from 'react';
import { C, MONO, qLabelStyle, questionStyle, verdictStyle } from './tokens';

/** The large ghosted numeral + uppercase theme name + hairline rule between groups. */
export function GroupDivider({ n, name, topPad = 88 }: { n: number; name: string; topPad?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, padding: `${topPad}px 0 8px` }}>
      <span style={{ fontSize: 64, fontWeight: 700, color: C.ghost, fontFamily: MONO, lineHeight: 1 }}>{n}</span>
      <span style={{ fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.textStrong }}>{name}</span>
      <div style={{ flex: 1, borderTop: `1px solid ${C.dividerGroup}` }} />
    </div>
  );
}

/** The left-column text stack: mono Q# label, question headline, verdict sentence. */
export function QHeader({
  q,
  question,
  verdict,
  maxWidth,
}: {
  q: string;
  question: string;
  verdict?: string;
  maxWidth?: number;
}) {
  return (
    <div style={{ maxWidth }}>
      <div style={qLabelStyle}>{q}</div>
      <div style={questionStyle}>{question}</div>
      {verdict !== undefined && <div style={verdictStyle}>{verdict}</div>}
    </div>
  );
}

/** A standard two-column question row: 360px verdict column + fluid evidence column. */
export function BriefingRow({
  q,
  question,
  verdict,
  children,
  top = 72,
  evidencePadTop = 8,
}: {
  q: string;
  question: string;
  verdict: string;
  children: ReactNode;
  top?: number;
  evidencePadTop?: number;
}) {
  return (
    <div
      className="grid grid-cols-1 min-[900px]:grid-cols-[360px_minmax(0,1fr)] items-start"
      style={{ gap: '32px 64px', padding: `${top}px 0 0` }}
    >
      <QHeader q={q} question={question} verdict={verdict} />
      <div style={{ paddingTop: evidencePadTop, minWidth: 0 }}>{children}</div>
    </div>
  );
}
