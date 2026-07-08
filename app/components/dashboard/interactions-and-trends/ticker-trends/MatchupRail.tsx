'use client';

import React from 'react';
import type { CSSProperties } from 'react';
import type { HotTicker } from '@/app/lib/types/trends';
import {
  typePalette, segsOf, teamSegsOf, totalOf, proofOf, edgeParts,
  qoqOf, devBadgeStyle,
} from './compute';
import { MomentumChart } from './charts';
import RichTextDisplay from '@/app/components/dashboard/shared/RichTextDisplay';

const sectionLabel: CSSProperties = {
  fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', color: '#71717a',
};
const divider = '1px solid rgba(39,39,42,0.5)';

const avatarStyle: CSSProperties = {
  width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(34,211,238,0.15)',
  color: '#22d3ee', fontSize: '10px', fontWeight: 700, display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};

function fmtNoteDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? '').join('');
}

function actStyle(on: boolean): CSSProperties {
  return {
    flex: 1, textAlign: 'center', padding: '8px 10px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    border: '1px solid ' + (on ? 'rgba(34,211,238,0.35)' : 'rgba(63,63,70,0.5)'),
    background: on ? 'rgba(34,211,238,0.08)' : 'transparent',
    color: on ? '#22d3ee' : '#52525b', whiteSpace: 'nowrap',
  };
}

interface MatchupRailProps {
  ticker: HotTicker;
  avg: number;
  showMomentum: boolean;
  showNotes: boolean;
  pinnedNoteId?: number | null;
  onNotes: () => void;
  onTalk: () => void;
  onPcr: () => void;
}

export default function MatchupRail({ ticker, avg, showMomentum, showNotes, pinnedNoteId, onNotes, onTalk, onPcr }: MatchupRailProps) {
  const sel = ticker;
  const p = typePalette(sel.type);
  const segs = segsOf(sel);
  const teamSegs = teamSegsOf(sel);
  const proof = proofOf(sel);
  const edge = edgeParts(sel);
  const qoq = qoqOf(sel);
  const dev = Math.round(qoq - avg);
  const heroText = (qoq > 0 ? '+' : '') + qoq + '%';
  const devText = (dev > 0 ? '+' : '') + dev + '% vs avg';

  // Notes: newest first. The panel shows the note pinned in the modal, or the
  // newest by default. Which note is pinned is chosen inside the Notes modal.
  const notes = [...sel.noteEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const hasNotes = notes.length > 0;
  const shownNote = notes.find((n) => n.id === pinnedNoteId) ?? notes[0] ?? null;

  const stancePill: CSSProperties = {
    display: 'inline-block', padding: '3px 9px', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap',
    background: p.bg, color: p.fg, border: '1px solid ' + p.bd,
  };

  return (
    <div style={{ width: 460, flexShrink: 0, background: 'rgba(24,24,27,0.6)', border: '1px solid rgba(39,39,42,0.5)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 1, background: 'linear-gradient(to right,transparent,rgba(34,211,238,0.5),transparent)' }} />

      {/* Matchup header */}
      <div style={{ padding: 16, borderBottom: divider }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '17px', fontWeight: 700 }}>
            <span style={{ color: '#22d3ee' }}>{sel.ticker}</span>
            <span style={{ color: '#71717a', fontWeight: 400, fontSize: '13px' }}> vs </span>
            <span style={{ color: '#fbbf24' }}>{sel.firmCompetitor}</span>
          </div>
          <span style={stancePill}>{sel.type}</span>
        </div>
        <div style={{ fontSize: '12px', color: '#a5a5b2', marginTop: 3 }}>{sel.name}{'  ·  '}{sel.firmName}</div>
      </div>

      {/* Why it's hot */}
      <div style={{ padding: '14px 16px', borderBottom: divider }}>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>WHY IT&apos;S HOT · {totalOf(sel)} TOUCHES</div>
        <div style={{ display: 'flex', height: 10, gap: 1 }}>
          {segs.map((s) => <div key={s.name} style={s.style} />)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
          {segs.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={s.dot} />
              <span style={{ fontSize: '12px', color: '#a5a5b2' }}>{s.name}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#e4e4e7' }}>{s.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Who's asking */}
      <div style={{ padding: '14px 16px', borderBottom: divider }}>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>WHO&apos;S ASKING · BY TEAM</div>
        <div style={{ display: 'flex', height: 10, gap: 1 }}>
          {teamSegs.map((s) => <div key={s.name} style={s.style} />)}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
          {teamSegs.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={s.dot} />
              <span style={{ fontSize: '12px', color: '#a5a5b2' }}>{s.name}</span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#e4e4e7' }}>{s.val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Proof points */}
      <div style={{ padding: '14px 16px', borderBottom: divider }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={sectionLabel}>PROOF POINTS</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={edge.badge}>{edge.label}</span>
            <span style={edge.scoreStyle}>{edge.scoreText}</span>
          </div>
        </div>
        {proof.map((row) => (
          <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
            <span style={{ width: 92, fontSize: '11px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{row.label}</span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ height: 5, background: 'rgba(34,211,238,0.1)' }}><div style={row.cw} /></div>
              <div style={{ height: 5, background: 'rgba(251,191,36,0.08)' }}><div style={row.fw} /></div>
            </div>
            <span style={{ width: 132, textAlign: 'right', fontSize: '13px', whiteSpace: 'nowrap' }}>
              <span style={{ color: '#22d3ee' }}>{row.c}</span>
              <span style={{ color: '#71717a' }}> vs </span>
              <span style={{ color: '#fbbf24' }}>{row.f}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Momentum (droppable) */}
      {showMomentum && (
        <div style={{ padding: '14px 16px', borderBottom: divider }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={sectionLabel}>MOMENTUM</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 700 }}>{heroText} QoQ</span>
              <span style={devBadgeStyle(dev)}>{devText}</span>
            </div>
          </div>
          <div style={{ height: 150 }}><MomentumChart ticker={sel} /></div>
        </div>
      )}

      {/* Internal notes (droppable) */}
      {showNotes && (
        <div style={{ padding: '14px 16px', borderBottom: divider, borderLeft: '2px solid #22d3ee', background: 'linear-gradient(to right,rgba(34,211,238,0.05) 0%,rgba(34,211,238,0.05) 45%,transparent 100%)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={sectionLabel}>INTERNAL NOTES</div>
              {notes.length > 0 && (
                <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.3)', background: 'rgba(34,211,238,0.08)', padding: '1px 6px', whiteSpace: 'nowrap' }}>
                  {notes.length} {notes.length === 1 ? 'NOTE' : 'NOTES'}
                </span>
              )}
            </div>
            <button onClick={onNotes} style={{ background: 'transparent', border: 'none', color: '#22d3ee', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              {hasNotes ? 'Edit ✎' : 'Add ✎'}
            </button>
          </div>
          {hasNotes && shownNote ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                <RichTextDisplay html={shownNote.noteText} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 10 }}>
                <span style={avatarStyle}>{initialsOf(shownNote.authorName)}</span>
                <span style={{ fontSize: '11px', color: '#a5a5b2' }}>
                  <span style={{ color: '#e4e4e7', fontWeight: 600 }}>{shownNote.authorName}</span> · {fmtNoteDate(shownNote.createdAt)}
                </span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#52525b', fontStyle: 'italic' }}>No notes yet — add positioning language for this matchup.</div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, marginTop: 'auto' }}>
        <button onClick={onNotes} style={actStyle(sel.noteEntries.length > 0)}>Notes</button>
        <button onClick={onTalk} style={actStyle(!!sel.talkingPointsUrl)}>Talking points ↗</button>
        <button onClick={onPcr} style={actStyle(!!sel.pcrUrl)}>PCR ↗</button>
      </div>
    </div>
  );
}
