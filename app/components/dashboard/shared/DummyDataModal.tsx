'use client';

import React, { useState, useEffect } from 'react';
import { X, Info } from 'lucide-react';

interface DummyDataModalProps {
  /** Name of the dashboard, e.g. "Portfolio Trends". */
  feature: string;
}

// A one-time-per-visit notice shown when a dashboard is still backed by sample
// data. Opens on mount (every navigation to the page) and is dismissible via the
// button, the X, the backdrop, or Escape. No persistence — it reappears on the
// next visit, which is intentional until the real data is wired up.
export default function DummyDataModal({ feature }: DummyDataModalProps) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-zinc-900 border border-zinc-700/50 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />

        {/* Header */}
        <div className="relative z-10 px-5 py-4 border-b border-zinc-800/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-amber-400/15 border border-amber-400/40 flex items-center justify-center flex-shrink-0">
              <Info className="w-4 h-4 text-amber-300" />
            </div>
            <h2 className="text-base font-medium text-white">Sample data only</h2>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 text-muted hover:text-white hover:bg-zinc-800 transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="relative z-10 p-5">
          <p className="text-sm text-zinc-300 leading-relaxed">
            <span className="text-white font-medium">{feature}</span> is currently showing{' '}
            <span className="text-amber-300 font-medium">dummy data</span>{' '}for demonstration
            purposes. The numbers, charts, and filters on this page aren&apos;t wired up to real
            client data yet.
          </p>
        </div>

        {/* Footer */}
        <div className="relative z-10 px-5 py-4 border-t border-zinc-800/50 flex justify-end">
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-sm font-medium bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:from-blue-500 hover:to-cyan-400 transition-all"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
