'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCurrentUser } from '@/app/lib/auth/context';
import { getKpiDashboardData, type KpiDashboardData, type KpiScope } from '@/app/lib/api/kpi';

import Masthead from '@/app/components/dashboard/kpis/briefing/Masthead';
import { GroupDivider, QHeader, BriefingRow } from '@/app/components/dashboard/kpis/briefing/Blocks';
import HeroStats from '@/app/components/dashboard/kpis/briefing/HeroStats';
import { WeeklyFlowChart, MixDriftChart, ParetoBlock } from '@/app/components/dashboard/kpis/briefing/Charts';
import CycleDumbbell from '@/app/components/dashboard/kpis/briefing/CycleDumbbell';
import EvidenceList, { type EvidenceRow } from '@/app/components/dashboard/kpis/briefing/EvidenceList';
import { DeptBars, SpawnBars, ChainRolledBars } from '@/app/components/dashboard/kpis/briefing/Bars';
import SegmentMatrixTable from '@/app/components/dashboard/kpis/briefing/SegmentMatrixTable';
import SankeyBlock from '@/app/components/dashboard/kpis/briefing/SankeyBlock';
import ClientBaseBlock from '@/app/components/dashboard/kpis/briefing/ClientBaseBlock';
import {
  buildHeroCards,
  fmtDate,
  verdictQ1,
  verdictFlow,
  verdictMix,
  verdictQ4,
  verdictQ5,
  verdictQ6,
  subtitleConc,
  verdictQ8,
  verdictQ9,
  verdictQ10,
  verdictQ12,
  verdictQ13,
  verdictQ14,
} from '@/app/components/dashboard/kpis/briefing/briefing-utils';
import { C } from '@/app/components/dashboard/kpis/briefing/tokens';

export default function KpiDashboard() {
  const { user, isLoading: authLoading } = useCurrentUser();

  const [scope, setScope] = useState<KpiScope>('all');
  const [period, setPeriod] = useState('1Y');
  const [data, setData] = useState<KpiDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Default scope once auth resolves: non-admins land on their own team, admins on
  // the cross-team aggregate. Guarded so a later refetch never stomps a manual pick.
  const defaultScopeAppliedRef = useRef(false);
  useEffect(() => {
    if (authLoading || !user || defaultScopeAppliedRef.current) return;
    defaultScopeAppliedRef.current = true;
    if (user.role !== 'admin' && user.team) setScope(`team:${user.team}`);
  }, [authLoading, user]);

  // Fetch the dashboard for the current (scope, period). `silent` skips the
  // masthead "updating…" note — used for realtime background refreshes so live
  // updates never flicker, while user-initiated scope/period changes still show it.
  const abortRef = useRef<AbortController | null>(null);
  const reloadData = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (authLoading) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (!opts?.silent) setIsLoading(true);
      try {
        const result = await getKpiDashboardData(
          { scope, period, clientDepts: [], intakeTypes: [], staleThreshold: '3w' },
          controller.signal
        );
        if (!controller.signal.aborted) setData(result);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') console.error('Failed to load KPI dashboard:', err);
      } finally {
        // Always clear on a non-aborted completion (even for a silent refetch) so a
        // realtime refresh that superseded a pending user refetch doesn't strand the note.
        if (!controller.signal.aborted) setIsLoading(false);
      }
    },
    [scope, period, authLoading]
  );

  // Initial load + refetch when the user changes scope/period (non-silent → "updating…").
  useEffect(() => {
    reloadData();
  }, [reloadData]);

  // Realtime: engagement mutations broadcast over the shared SSE stream
  // (/api/client-interactions/events). Refetch silently on any change. A single
  // mount-once connection (via reloadRef) avoids reconnecting on every scope/period
  // change; a ~400ms debounce coalesces bursts (e.g. a bulk upload).
  const reloadRef = useRef(reloadData);
  useEffect(() => {
    reloadRef.current = reloadData;
  }, [reloadData]);

  useEffect(() => {
    const es = new EventSource('/api/client-interactions/events');
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = (e) => {
      if (e.data === 'connected') return; // initial heartbeat
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current({ silent: true }), 400);
    };
    // Intentionally no onerror handler: let the browser's native EventSource
    // auto-reconnect keep a long-open dashboard live across transient drops.
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, []);

  const staleRows: EvidenceRow[] = (data?.staleEngagements ?? []).slice(0, 8).map(r => ({
    key: String(r.id),
    name: r.clientName,
    meta: `${r.clientDept} · ${r.type}`,
    badge: `${r.daysOpen}d`,
    badgeColor: r.daysOpen >= 180 ? '#fb7185' : r.daysOpen >= 90 ? '#fb923c' : '#fbbf24',
  }));

  const chaseRows: EvidenceRow[] = (data?.extended.chaseList ?? []).slice(0, 8).map((r, i) => ({
    key: `${r.clientName}-${r.type}-${i}`,
    name: r.clientName,
    meta: `${r.clientDept} · ${r.type}`,
    assignee: r.assignees.join(', ') || undefined,
    rightText: `started ${fmtDate(r.started)}`,
    badge: `${r.daysSince}d`,
    badgeColor: C.amber,
  }));

  const dormantRows: EvidenceRow[] = (data?.dormantClients ?? []).slice(0, 8).map((r, i) => ({
    key: `${r.clientName}-${i}`,
    name: r.clientName,
    meta: `${r.clientDept} · ${r.historicalCount} engagements`,
    assignee: r.assignees.join(', ') || undefined,
    rightText: `last ${fmtDate(r.lastEngagedDate)}`,
    badge: `${r.daysSinceLast}d`,
    badgeColor: C.violet,
  }));

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: C.bg, color: '#ededed' }}>
      <div className="flex-1 overflow-y-auto">
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 48px 110px' }}>
          <Masthead scope={scope} period={period} onScopeChange={setScope} onPeriodChange={setPeriod} loading={isLoading} />

          {data ? (
            <>
              {/* ============ GROUP 1 — Demand & throughput ============ */}
              <GroupDivider n={1} name="Demand & throughput" topPad={56} />

              <div style={{ padding: '44px 0 0' }}>
                <QHeader
                  q="Q1"
                  question="How much work are we doing — and is it trending up or down?"
                  verdict={verdictQ1(data, scope, period)}
                  maxWidth={640}
                />
                <HeroStats cards={buildHeroCards(data, period)} />
              </div>

              <BriefingRow
                q="Q2"
                question="Is open work growing because intake rose — or because delivery slowed?"
                verdict={verdictFlow(data)}
              >
                <WeeklyFlowChart data={data.extended.weeklyFlow} />
              </BriefingRow>

              <BriefingRow q="Q3" question="Is our work mix drifting toward low-leverage tasks?" verdict={verdictMix(data)}>
                <MixDriftChart data={data.extended.mixDrift} />
              </BriefingRow>

              {/* ============ GROUP 2 — Speed ============ */}
              <GroupDivider n={2} name="Speed" />

              <BriefingRow q="Q4" question="How fast do we turn work around?" verdict={verdictQ4(data)} top={44} evidencePadTop={14}>
                <CycleDumbbell data={data.extended.cycleTimes} />
              </BriefingRow>

              <BriefingRow q="Q5" question="What open work has gone stale?" verdict={verdictQ5(data)}>
                <EvidenceList
                  rows={staleRows}
                  caption="Open 3 weeks or longer · oldest first"
                  empty="Nothing open longer than 3 weeks — nice."
                />
              </BriefingRow>

              {/* ============ GROUP 3 — Value & outcomes ============ */}
              <GroupDivider n={3} name="Value & outcomes" />

              <BriefingRow
                q="Q6"
                question="Which client departments drive our volume — and which are most efficient?"
                verdict={verdictQ6(data)}
                top={44}
              >
                <DeptBars data={data.clientDepts} />
              </BriefingRow>

              <BriefingRow q="Q7" question="Which clients concentrate our NNA?" verdict={subtitleConc(data)}>
                <ParetoBlock data={data.nnaConcentration} />
              </BriefingRow>

              <BriefingRow
                q="Q8"
                question="What is the full value of work we originate, once downstream NNA rolls up the chain?"
                verdict={verdictQ8(data)}
                evidencePadTop={14}
              >
                <ChainRolledBars data={data.extended.chainRolled} />
              </BriefingRow>

              <BriefingRow q="Q9" question="Which segments convert — and at what typical size?" verdict={verdictQ9(data)} evidencePadTop={14}>
                <SegmentMatrixTable matrix={data.extended.segmentMatrix} />
              </BriefingRow>

              <BriefingRow q="Q10" question="Which delivered projects are we still chasing for an NNA outcome?" verdict={verdictQ10(data)}>
                <EvidenceList
                  rows={chaseRows}
                  caption="Status 'Follow Up' · open 6+ months · oldest first"
                  empty="No 'Follow Up' projects open longer than 6 months — all caught up."
                />
              </BriefingRow>

              {/* ============ GROUP 4 — Work journey ============ */}
              <GroupDivider n={4} name="Work journey" />

              <SankeyBlock
                q="Q11"
                question="How does work flow from intake channel to project type to outcome?"
                sankey={data.journeySankey}
                templates={data.journeyTemplates}
              />

              <BriefingRow q="Q12" question="Does our work generate more work?" verdict={verdictQ12(data)} evidencePadTop={14}>
                <SpawnBars data={data.extended.spawnRate} />
              </BriefingRow>

              {/* ============ GROUP 5 — People & relationships ============ */}
              <GroupDivider n={5} name="People & relationships" />

              <BriefingRow
                q="Q13"
                question="Is our internal client base growing — or just recycling?"
                verdict={verdictQ13(data)}
                top={44}
                evidencePadTop={14}
              >
                <ClientBaseBlock clientBase={data.extended.clientBase} uniquePerDept={data.extended.uniquePerDept} />
              </BriefingRow>

              <BriefingRow q="Q14" question="Which valuable clients have gone quiet?" verdict={verdictQ14(data)}>
                <EvidenceList
                  rows={dormantRows}
                  caption="Dormant = no activity in 60+ days · 3+ past engagements · longest silent first"
                  empty="No client quiet for 60+ days — all still active."
                />
              </BriefingRow>
            </>
          ) : !isLoading ? (
            <div style={{ padding: '80px 0', textAlign: 'center', color: C.textMuted }}>Failed to load KPI data.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
