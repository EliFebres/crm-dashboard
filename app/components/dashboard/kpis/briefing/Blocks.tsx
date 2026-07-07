'use client';

import React, { type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { C, MONO, qLabelStyle, questionStyle, verdictStyle } from './tokens';
import { Q_EXPLAIN } from './explanations';

/** The mono cyan "Q#" label with an info icon whose hover tooltip explains how the
 *  visual is determined (compressed to the top-level calculation). */
export function QLabel({ q }: { q: string }) {
  const explain = Q_EXPLAIN[q];
  return (
    <div style={{ ...qLabelStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span>{q}</span>
      {explain && (
        <span className="group" style={{ position: 'relative', display: 'inline-flex' }}>
          <Info className="w-3.5 h-3.5 cursor-help text-[#52525b] group-hover:text-[#22d3ee] transition-colors" />
          <span
            className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              left: 0,
              zIndex: 400,
              width: 260,
              background: 'rgba(16,16,20,0.98)',
              border: '1px solid #2b2b33',
              borderRadius: 8,
              padding: '9px 11px',
              fontSize: 11.5,
              lineHeight: 1.5,
              letterSpacing: 0,
              color: C.textSecondary,
              fontFamily: 'Helvetica, Arial, sans-serif',
              boxShadow: '0 12px 30px rgba(0,0,0,0.5)',
            }}
          >
            {explain}
          </span>
        </span>
      )}
    </div>
  );
}

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
      <QLabel q={q} />
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
