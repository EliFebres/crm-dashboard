'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, Landmark } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/app/components/ui/Popover';

export type EquityScope = 'Total' | 'US' | 'Developed' | 'Emerging Markets';

export const EQUITY_SCOPES: readonly EquityScope[] = ['Total', 'US', 'Developed', 'Emerging Markets'];

interface Props {
  equity: EquityScope | null;
  fixedIncome: boolean;
  onEquityChange: (next: EquityScope | null) => void;
  onFixedIncomeChange: (next: boolean) => void;
}

// Hybrid asset-class filter: radio-style equity selector (Total / US / Developed / EM,
// at most one) plus an independent Fixed Income checkbox. Enforces an at-least-one-
// selection floor — clicks that would leave both off are no-ops.
export default function AssetClassFilterButton({
  equity,
  fixedIncome,
  onEquityChange,
  onFixedIncomeChange,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

  const isFiltered = equity !== 'Total' || !fixedIncome;

  const triggerLabel = (() => {
    if (equity && fixedIncome) return `${equity} + Fixed Income`;
    if (equity) return equity;
    return 'Fixed Income';
  })();

  const handleEquityClick = (scope: EquityScope) => {
    if (scope === equity) {
      // Click on already-active row → deselect, unless that would empty the filter.
      if (fixedIncome) onEquityChange(null);
      return;
    }
    onEquityChange(scope);
  };

  const handleFixedIncomeClick = () => {
    if (fixedIncome && equity === null) return; // floor: can't deselect the last selection
    onFixedIncomeChange(!fixedIncome);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex items-center gap-1.5 px-3 py-2 backdrop-blur-sm border text-sm transition-colors ${
            isFiltered
              ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
              : 'bg-zinc-900/50 border-zinc-700/50 text-muted hover:bg-zinc-800/50 hover:border-zinc-600/50'
          }`}
        >
          <Landmark className={`w-4 h-4 ${isFiltered ? 'text-cyan-400' : 'text-muted'}`} />
          {triggerLabel}
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''} ${isFiltered ? 'text-cyan-400' : 'text-muted'}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="min-w-[var(--radix-popover-trigger-width)] w-max">
        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
          Equity
        </div>
        {EQUITY_SCOPES.map((scope) => {
          const active = equity === scope;
          const isFloor = active && !fixedIncome;
          return (
            <button
              key={scope}
              onClick={() => handleEquityClick(scope)}
              disabled={isFloor}
              className={`w-full flex items-center gap-2 pl-5 pr-3 py-2 text-sm text-left transition-colors ${
                active
                  ? 'bg-cyan-500/10 text-cyan-400'
                  : 'text-muted hover:bg-white/[0.05]'
              } ${isFloor ? 'cursor-default' : ''}`}
            >
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                active
                  ? 'bg-cyan-500 border-cyan-500'
                  : 'border-zinc-600'
              }`}>
                {active && <Check className="w-3 h-3 text-white" />}
              </div>
              {scope}
            </button>
          );
        })}
        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted uppercase tracking-wider">
          Fixed Income
        </div>
        <button
          onClick={handleFixedIncomeClick}
          disabled={fixedIncome && equity === null}
          className={`w-full flex items-center gap-2 pl-5 pr-3 py-2 text-sm text-left transition-colors ${
            fixedIncome
              ? 'bg-cyan-500/10 text-cyan-400'
              : 'text-muted hover:bg-white/[0.05]'
          } ${fixedIncome && equity === null ? 'cursor-default' : ''}`}
        >
          <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
            fixedIncome
              ? 'bg-cyan-500 border-cyan-500'
              : 'border-zinc-600'
          }`}>
            {fixedIncome && <Check className="w-3 h-3 text-white" />}
          </div>
          Fixed Income
        </button>
      </PopoverContent>
    </Popover>
  );
}
