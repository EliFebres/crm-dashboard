'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/app/lib/auth/context';
import { getTeams } from '@/app/lib/api/org';
import { toDisplayName, type TeamMember } from '@/app/lib/auth/types';
import type { KpiReportSubject, KpiScope } from '@/app/lib/api/kpi';
import { C, MONO } from './tokens';
import { PERIOD_LONG, HEAD_PERIOD, comparisonLabel, headlineScope, teamOf } from './briefing-utils';

const PERIODS = ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];

interface MastheadProps {
  scope: KpiScope;
  period: string;
  onScopeChange: (s: KpiScope) => void;
  onPeriodChange: (p: string) => void;
  loading: boolean;
  /** Builds and downloads the PDF report for the current scope and period. */
  onGenerateReport: (subject: KpiReportSubject) => Promise<void>;
}

interface MenuOption {
  label: string;
  value: string;
  active: boolean;
  /** Greyed out and not clickable; used for hints inside a menu. */
  disabled?: boolean;
}

/** The popover list shared by the byline dropdowns and the report menu. */
function MenuPanel({
  options,
  onSelect,
  minWidth,
  align = 'left',
}: {
  options: MenuOption[];
  onSelect: (value: string) => void;
  minWidth: number;
  align?: 'left' | 'right';
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        [align]: 0,
        minWidth,
        maxHeight: 320,
        overflowY: 'auto',
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
          onClick={() => !o.disabled && onSelect(o.value)}
          className={o.disabled ? undefined : 'hover:bg-white/5'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 6,
            fontSize: 13,
            cursor: o.disabled ? 'default' : 'pointer',
            color: o.disabled ? C.textFaint : o.active ? C.cyan : '#d4d4d8',
          }}
        >
          <span>{o.label}</span>
          {o.active && <span style={{ color: C.cyan, fontSize: 12 }}>●</span>}
        </div>
      ))}
    </div>
  );
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
      {open && <MenuPanel options={options} onSelect={onSelect} minWidth={minWidth} />}
    </span>
  );
}

/** Report menu values. Picking a teammate uses `person:<display name>`. */
const REPORT_ME = 'me';
const REPORT_TEAM = 'team';
const REPORT_SOMEONE = 'someone';
const REPORT_BACK = 'back';

export default function Masthead({ scope, period, onScopeChange, onPeriodChange, loading, onGenerateReport }: MastheadProps) {
  const { user } = useCurrentUser();
  const [teams, setTeams] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<'scope' | 'period' | 'report' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Report menu: the founder can drill into "Someone else…" to pick from the roster.
  const [pickingPerson, setPickingPerson] = useState(false);
  const [roster, setRoster] = useState<TeamMember[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

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

  const myName = user ? toDisplayName(user.firstName, user.lastName) : null;
  const myFullName = user ? `${user.firstName} ${user.lastName}`.trim() : '';

  // Scope options mirror the server's access rules (canAccessKpiScope): your own
  // work, the cross-team aggregate, and either every team (admins) or your own.
  const scopeOptions = useMemo<MenuOption[]>(() => {
    const all = { label: 'Cross-team aggregate', value: 'all', active: scope === 'all' };
    if (!user) return [all];
    const me = { label: myFullName || 'My work', value: 'me', active: scope === 'me' };
    const teamList = user.role === 'admin' ? teams : user.team ? [user.team] : [];
    return [me, all, ...teamList.map(t => ({ label: t, value: `team:${t}`, active: scope === `team:${t}` }))];
  }, [user, teams, scope, myFullName]);

  const periodOptions = useMemo<MenuOption[]>(
    () => PERIODS.map(pk => ({ label: `${PERIOD_LONG[pk]} (${pk})`, value: pk, active: pk === period })),
    [period]
  );

  // In the personal view, team-level report actions target the user's own team.
  const teamName = teamOf(scope) ?? (scope === 'me' ? user?.team || null : null);
  const scopeTrigger = scope === 'me' ? myFullName || 'My work' : teamOf(scope) || 'Cross-team aggregate';

  // The founder's roster follows the page's team scope; reset it when that changes.
  useEffect(() => {
    setRoster(null);
    setPickingPerson(false);
  }, [teamName]);

  useEffect(() => {
    if (!pickingPerson || roster || !teamName) return;
    fetch(`/api/team-members?team=${encodeURIComponent(teamName)}`)
      .then(r => (r.ok ? r.json() : []))
      .then((members: TeamMember[]) => setRoster(members))
      .catch(() => setRoster([]));
  }, [pickingPerson, roster, teamName]);

  const reportOptions = useMemo<MenuOption[]>(() => {
    if (pickingPerson) {
      const back = { label: '← Back', value: REPORT_BACK, active: false };
      if (!teamName) {
        return [back, { label: 'Pick a team in the byline first', value: 'hint', active: false, disabled: true }];
      }
      if (!roster) return [back, { label: 'Loading…', value: 'hint', active: false, disabled: true }];
      const others = roster.filter(m => m.displayName !== myName);
      if (others.length === 0) return [back, { label: 'No one else on this team', value: 'hint', active: false, disabled: true }];
      return [back, ...others.map(m => ({ label: `${m.firstName} ${m.lastName}`, value: `person:${m.displayName}`, active: false }))];
    }
    const options: MenuOption[] = [];
    if (myName) options.push({ label: 'My report', value: REPORT_ME, active: false });
    options.push({ label: teamName ? `${teamName} team report` : 'Cross-team report', value: REPORT_TEAM, active: false });
    if (user?.isFounder) options.push({ label: 'Someone else…', value: REPORT_SOMEONE, active: false });
    return options;
  }, [pickingPerson, teamName, roster, myName, user?.isFounder]);

  const handleReportSelect = async (value: string) => {
    if (value === REPORT_SOMEONE) return setPickingPerson(true);
    if (value === REPORT_BACK) return setPickingPerson(false);

    let subject: KpiReportSubject;
    if (value === REPORT_TEAM) subject = { kind: 'team' };
    else if (value === REPORT_ME && myName) subject = { kind: 'person', displayName: myName };
    else if (value.startsWith('person:')) subject = { kind: 'person', displayName: value.slice('person:'.length) };
    else return;

    setOpenMenu(null);
    setPickingPerson(false);
    setReportError(null);
    setGenerating(true);
    try {
      await onGenerateReport(subject);
    } catch (err) {
      console.error('Report generation failed:', err);
      setReportError(err instanceof Error ? err.message : "Couldn't generate the report.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div ref={rootRef} style={{ padding: '64px 0 20px', position: 'relative' }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.cyan }}>
        Team KPIs · Briefing view
      </div>
      <div
        data-briefing-menu
        style={{ position: 'absolute', top: 58, right: 0, display: 'flex', alignItems: 'center', gap: 10 }}
      >
        {reportError && <span style={{ fontSize: 12, color: C.red }}>{reportError}</span>}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => {
              setReportError(null);
              setPickingPerson(false);
              setOpenMenu(m => (m === 'report' ? null : 'report'));
            }}
            disabled={generating}
            className="flex items-center gap-1.5 transition-colors hover:!text-[#22d3ee] disabled:opacity-60 disabled:cursor-wait"
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: openMenu === 'report' ? C.cyan : C.textSecondary,
            }}
            title="Download a PDF summary for the selected period"
          >
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
            {generating ? 'Generating…' : 'Generate PDF'}
          </button>
          {openMenu === 'report' && (
            <MenuPanel options={reportOptions} onSelect={handleReportSelect} minWidth={220} align="right" />
          )}
        </div>
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
