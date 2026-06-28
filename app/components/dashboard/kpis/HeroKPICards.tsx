'use client';

import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { HeroKpis } from '@/app/lib/api/kpi';
import { formatCurrency, formatNumber, formatDelta, deltaClass } from './utils';

interface HeroKPICardsProps {
  heroKpis: HeroKpis;
}

type CardDef = {
  label: string;
  value: string;
  deltaPercent: number;
  invertDelta?: boolean;
  sublabel: string;
};

export default function HeroKPICards({ heroKpis }: HeroKPICardsProps) {
  const cards: CardDef[] = [
    {
      label: 'Total Interactions',
      value: formatNumber(heroKpis.interactions.value),
      deltaPercent: heroKpis.interactions.deltaPercent,
      sublabel: heroKpis.periodLabel,
    },
    {
      label: 'Total In-Progress Interactions',
      value: formatNumber(heroKpis.inProgress.value),
      deltaPercent: heroKpis.inProgress.deltaPercent,
      sublabel: heroKpis.periodLabel,
    },
    {
      label: 'Total NNA',
      value: formatCurrency(heroKpis.nna.value),
      deltaPercent: heroKpis.nna.deltaPercent,
      sublabel: heroKpis.periodLabel,
    },
    {
      label: 'Avg NNA / Interaction',
      value: formatCurrency(heroKpis.avgNnaPerInteraction.value),
      deltaPercent: heroKpis.avgNnaPerInteraction.deltaPercent,
      sublabel: heroKpis.periodLabel,
    },
    {
      label: 'Completion Rate',
      value: `${heroKpis.completionRate.value.toFixed(0)}%`,
      deltaPercent: heroKpis.completionRate.deltaPercent,
      sublabel: heroKpis.periodLabel,
    },
    {
      label: 'Zero-NNA Rate',
      value: `${heroKpis.zeroNnaRate.value.toFixed(0)}%`,
      deltaPercent: heroKpis.zeroNnaRate.deltaPercent,
      // Lower zero-NNA rate is better, so invert the color
      invertDelta: true,
      sublabel: 'of completed',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
      {cards.map((c) => {
        const delta = c.deltaPercent;
        const positive = c.invertDelta ? delta < 0 : delta > 0;
        return (
          <div
            key={c.label}
            className="relative h-[140px] overflow-visible bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl hover:border-zinc-700/50 transition-all duration-300"
          >
            <div className="absolute top-3.5 left-5 z-10">
              <p className="text-white text-[0.8rem]">{c.label}</p>
            </div>
            <div className="relative z-10 pt-6">
              <p className="text-[2.5rem] font-bold text-white mb-2 tracking-tight leading-none">
                {c.value}
              </p>
              <div className="flex items-center gap-2 ml-1">
                <span
                  className={`flex items-center gap-1 text-[0.9rem] font-medium ${deltaClass(delta, c.invertDelta)}`}
                  style={{
                    textShadow: positive
                      ? '0 0 4px rgba(57, 255, 20, 0.3)'
                      : delta !== 0 ? '0 0 4px rgba(255, 49, 49, 0.3)' : undefined,
                  }}
                >
                  {delta !== 0 && (positive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />)}
                  {formatDelta(delta)}
                </span>
                <span className="text-xs text-muted">{c.sublabel}</span>
              </div>
            </div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          </div>
        );
      })}
    </div>
  );
}
