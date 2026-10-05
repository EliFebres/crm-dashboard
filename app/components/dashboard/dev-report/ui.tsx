'use client';

import React from 'react';

/** Shared look for the Dev Report page (matches the admin settings forms). */
export const INPUT =
  'w-full px-2.5 py-1.5 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors';
export const PRIMARY_BTN =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity';
export const SECONDARY_BTN =
  'inline-flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700/50 text-zinc-200 text-sm rounded-lg hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export function Section({
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-2.5">
          <Icon className="w-5 h-5 text-cyan-400 mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-muted text-xs mt-0.5">{description}</p>
          </div>
        </div>
        {actions ? <div className="flex items-center gap-2 flex-shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Inline status line under a form: an error in red or a confirmation in green. */
export function StatusLine({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error) return <p className="text-xs text-red-400 mt-2">{error}</p>;
  if (ok) return <p className="text-xs text-emerald-400 mt-2">{ok}</p>;
  return null;
}
