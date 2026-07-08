'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '@/app/lib/auth/context';
import { getTeams } from '@/app/lib/api/org';
import type { KpiScope } from '@/app/lib/api/kpi';
import { C, MONO } from './tokens';
import { PERIOD_LONG, HEAD_PERIOD, comparisonLabel, headlineScope, teamOf } from './briefing-utils';

const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

interface MastheadProps {
  scope: KpiScope;
  period: string;
  onScopeChange: (s: KpiScope) => void;
  onPeriodChange: (p: string) => void;
  loading: boolean;
}

interface MenuOption {
  label: string;
  value: string;
  active: boolean;
}

/** One inline dashed-underline dropdown trigger + its popover menu (the byline control). */
function BylineMenu({
  triggerLabel,
  open,
  onToggle,
  options,
  onSelect,
  minWidth,
}: {
  triggerLabel: string;
  open: boolean;
  onToggle: () => void;
  options: MenuOption[];
  onSelect: (value: string) => void;
  minWidth: number;
}) {
  return (
    <span style={{ position: 'relative', display: 'inline-block' }} data-briefing-menu>
      <button
        onClick={onToggle}
        className="transition-colors hover:!text-[#22d3ee]"
        style={{
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 14,
          color: C.textStrong,
          borderBottom: `1px dashed ${open ? C.cyan : C.textFaint}`,
          padding: '0 1px 2px',
        }}
      >
        {triggerLabel} <span style={{ fontSize: 10, color: C.textFaint }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth,
            background: 'rgba(16,16,20,0.98)',
            border: '1px solid #2b2b33',
            borderRadius: 10,
            padding: 5,
            zIndex: 300,
            boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          }}
        >
          {options.map(o => (
            <div
              key={o.value}
              onClick={() => onSelect(o.value)}
              className="hover:bg-white/5"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                color: o.active ? C.cyan : '#d4d4d8',
              }}
            >
              <span>{o.label}</span>
              {o.active && <span style={{ color: C.cyan, fontSize: 12 }}>●</span>}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

export default function Masthead({ scope, period, onScopeChange, onPeriodChange, loading }: MastheadProps) {
  const { user } = useCurrentUser();
  const [teams, setTeams] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<'scope' | 'period' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getTeams().then(items => setTeams(items.map(t => t.name))).catch(() => setTeams([]));
  }, []);

  // Close any open menu on an outside click.
  useEffect(() => {
    if (!openMenu) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest?.('[data-briefing-menu]')) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openMenu]);

  // Scope options mirror ScopeSelector's access rules: admins see every team;
  // non-admins are limited to the cross-team aggregate or their own team.
  const scopeOptions = useMemo<MenuOption[]>(() => {
    const all = { label: 'Cross-team aggregate', value: 'all', active: scope === 'all' };
    if (!user) return [all];
    const teamList = user.role === 'admin' ? teams : user.team ? [user.team] : [];
    return [all, ...teamList.map(t => ({ label: t, value: `team:${t}`, active: scope === `team:${t}` }))];
  }, [user, teams, scope]);

  const periodOptions = useMemo<MenuOption[]>(
    () => PERIODS.map(pk => ({ label: `${PERIOD_LONG[pk]} (${pk})`, value: pk, active: pk === period })),
    [period]
  );

  const teamName = teamOf(scope);
  const scopeTrigger = teamName || 'Cross-team aggregate';

  return (
    <div ref={rootRef} style={{ padding: '64px 0 20px' }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.cyan }}>
        Team KPIs · Briefing view
      </div>
      <div
        style={{
          fontSize: 38,
          fontWeight: 300,
          color: C.textPrimary,
          letterSpacing: '-0.02em',
          lineHeight: 1.2,
          marginTop: 14,
          maxWidth: 820,
        }}
      >
        Fourteen questions about the work {headlineScope(scope)} did {HEAD_PERIOD[period]} — answered by the data.
      </div>
      <div
        style={{
          fontSize: 14,
          color: C.textMuted,
          marginTop: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>Reading</span>
        <BylineMenu
          triggerLabel={scopeTrigger}
          open={openMenu === 'scope'}
          onToggle={() => setOpenMenu(m => (m === 'scope' ? null : 'scope'))}
          options={scopeOptions}
          onSelect={v => {
            setOpenMenu(null);
            onScopeChange(v as KpiScope);
          }}
          minWidth={210}
        />
        <span>over</span>
        <BylineMenu
          triggerLabel={PERIOD_LONG[period]}
          open={openMenu === 'period'}
          onToggle={() => setOpenMenu(m => (m === 'period' ? null : 'period'))}
          options={periodOptions}
          onSelect={v => {
            setOpenMenu(null);
            onPeriodChange(v);
          }}
          minWidth={170}
        />
        <span style={{ color: C.textFaint }}>·</span>
        <span style={{ color: C.textFaint }}>{comparisonLabel(period)}</span>
        {loading && <span style={{ color: C.cyan, fontSize: 12 }}>updating…</span>}
      </div>
    </div>
  );
}
