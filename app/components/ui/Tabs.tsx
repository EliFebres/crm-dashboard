'use client';

import React from 'react';

export interface TabDef<K extends string = string> {
  key: K;
  label: string;
  icon?: React.ReactNode;
}

/**
 * Segmented pill tab bar, matching the house style used by JourneyExplorer:
 * active tab gets the cyan→blue gradient, inactive tabs are muted.
 */
export function TabBar<K extends string>({
  tabs, active, onChange, className = '',
}: {
  tabs: TabDef<K>[];
  active: K;
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 bg-zinc-800/60 border border-zinc-700/50 p-1 rounded-lg ${className}`}
    >
      {tabs.map(tab => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              isActive
                ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white'
                : 'text-muted hover:text-white'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
