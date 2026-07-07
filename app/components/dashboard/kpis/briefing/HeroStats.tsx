'use client';

import React from 'react';
import { C, MONO } from './tokens';
import type { HeroCard } from './briefing-utils';

/** Q1 evidence — the 6-up row of hero stats (collapses to 3-up on narrow widths). */
export default function HeroStats({ cards }: { cards: HeroCard[] }) {
  return (
    <div className="grid grid-cols-3 min-[820px]:grid-cols-6" style={{ gap: '36px 28px', marginTop: 36 }}>
      {cards.map(card => (
        <div key={card.label}>
          <div style={{ fontSize: 42, fontWeight: 300, color: C.textPrimary, fontFamily: MONO, letterSpacing: '-0.03em', lineHeight: 1 }}>
            {card.value}
          </div>
          <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 10 }}>{card.label}</div>
          <div style={{ fontFamily: MONO, fontSize: 12, marginTop: 5, color: card.deltaColor, textShadow: card.deltaShadow }}>
            {card.deltaText} <span style={{ color: C.textFaint, textShadow: 'none', fontSize: 10 }}>{card.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
