'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Clock, Settings, Check } from 'lucide-react';
import { STALE_THRESHOLDS, type StaleEngagement } from '@/app/lib/api/kpi';

function daysBadgeClass(days: number): string {
  if (days >= 180) return 'bg-rose-500/15 text-rose-400 border border-rose-500/30';
  if (days >= 90) return 'bg-orange-500/15 text-orange-400 border border-orange-500/30';
  return 'bg-amber-500/15 text-amber-400 border border-amber-500/30';
}

// Threshold options (key + label), ordered, from the shared source of truth.
const STALE_OPTIONS = Object.entries(STALE_THRESHOLDS).map(([key, { label }]) => ({ key, label }));

interface Props {
  data: StaleEngagement[];
  staleThreshold: string;
  onStaleThresholdChange: (key: string) => void;
}

export default function StaleEngagementsTable({ data, staleThreshold, onStaleThresholdChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentLabel = STALE_THRESHOLDS[staleThreshold]?.label ?? '3 weeks';

  return (
    <div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 rounded-xl h-full flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-400" />
          <div>
            <h3 className="text-white text-base font-semibold">Stale Open Work</h3>
            <p className="text-xs text-muted">Open longer than {currentLabel} — worth a check-in</p>
          </div>
        </div>
        {/* Gear (top-right): choose how long work must be ongoing to count as stale */}
        <div className="relative flex-shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            title="Stale threshold"
            aria-label="Stale threshold settings"
            className={`p-1 rounded-md transition-colors ${menuOpen ? 'text-amber-400 bg-white/[0.05]' : 'text-muted hover:text-amber-400 hover:bg-white/[0.05]'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1">
              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted">Stale after</p>
              {STALE_OPTIONS.map(o => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => { onStaleThresholdChange(o.key); setMenuOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors ${
                    staleThreshold === o.key
                      ? 'text-amber-400 bg-amber-500/10'
                      : 'text-zinc-200 hover:bg-zinc-700/50'
                  }`}
                >
                  {o.label}
                  {staleThreshold === o.key && <Check className="w-3.5 h-3.5" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted">Nothing stale — nice.</div>
      ) : (
        <div className="overflow-y-auto max-h-[280px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900/95 backdrop-blur">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-zinc-800">
                <th className="py-2 pr-2">Client · Dept</th>
                <th className="py-2 pr-2">Type</th>
                <th className="py-2 pr-2">Status</th>
                <th className="py-2 text-right">Days Open</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-white/[0.02] transition-colors">
                  <td className="py-2 pr-2">
                    <div className="text-zinc-200 truncate max-w-[200px]">{r.clientName}</div>
                    <div className="text-[10px] text-muted">{r.clientDept}</div>
                  </td>
                  <td className="py-2 pr-2 text-muted text-xs">{r.type}</td>
                  <td className="py-2 pr-2 text-xs text-zinc-200">{r.status}</td>
                  <td className="py-2 text-right">
                    <span className={`text-xs font-mono px-2 py-0.5 rounded ${daysBadgeClass(r.daysOpen)}`}>
                      {r.daysOpen}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
