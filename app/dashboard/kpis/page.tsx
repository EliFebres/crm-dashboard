'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Building2, Inbox, Loader2 } from 'lucide-react';
import DashboardHeader from '@/app/components/dashboard/shared/DashboardHeader';
import ScopeSelector, { KPI_DELIVERY_TEAMS } from '@/app/components/dashboard/kpis/ScopeSelector';
import { useCurrentUser } from '@/app/lib/auth/context';
import HeroKPICards from '@/app/components/dashboard/kpis/HeroKPICards';
import JourneyExplorer from '@/app/components/dashboard/kpis/JourneyExplorer';
import ClientDeptChart from '@/app/components/dashboard/kpis/ClientDeptChart';
import NnaConcentrationCard from '@/app/components/dashboard/kpis/NnaConcentrationCard';
import StaleEngagementsTable from '@/app/components/dashboard/kpis/StaleEngagementsTable';
import DormantClientsTable from '@/app/components/dashboard/kpis/DormantClientsTable';
import { getKpiDashboardData, type KpiDashboardData, type KpiScope } from '@/app/lib/api/kpi';

const CLIENT_DEPT_OPTIONS = ['All Departments', 'Advisory', 'Brokerage', 'Institutional', 'Retirement'];
const INTAKE_OPTIONS = ['All Intake Types', 'IRQ', 'SERF', 'Ad-Hoc'];

export default function KpiDashboard() {
  const { user, isLoading: authLoading } = useCurrentUser();

  const [scope, setScope] = useState<KpiScope>('all');
  const [period, setPeriod] = useState('1Y');
  const [clientDepts, setClientDepts] = useState<string[]>([]);
  const [intakeTypes, setIntakeTypes] = useState<string[]>([]);
  const [staleThreshold, setStaleThreshold] = useState('3w');

  const [data, setData] = useState<KpiDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Apply the default scope once the auth context finishes loading: everyone
  // (including admins) defaults to their own team if they're on a KPI
  // delivery team, otherwise 'all'. Guarded by a ref so a later user refetch
  // doesn't stomp on a manual selection.
  const defaultScopeAppliedRef = useRef(false);
  useEffect(() => {
    if (authLoading || !user || defaultScopeAppliedRef.current) return;
    defaultScopeAppliedRef.current = true;
    const isKpiTeam = (KPI_DELIVERY_TEAMS as readonly string[]).includes(user.team);
    if (isKpiTeam) setScope(`team:${user.team}`);
  }, [authLoading, user]);

  useEffect(() => {
    // Wait for the user context so the first fetch uses the correct default.
    if (authLoading) return;
    const controller = new AbortController();
    // Defer the setState so it's not synchronously inside the effect body,
    // matching the pattern used by the Client Interactions page.
    const id = setTimeout(async () => {
      setIsLoading(true);
      try {
        const result = await getKpiDashboardData(
          { scope, period, clientDepts, intakeTypes, staleThreshold },
          controller.signal
        );
        setData(result);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to load KPI dashboard:', err);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 0);
    return () => {
      clearTimeout(id);
      controller.abort();
    };
  }, [scope, period, clientDepts, intakeTypes, staleThreshold, authLoading]);

  const subtitle = data?.scope.kind === 'team'
    ? `Team · ${data.scope.team}`
    : 'Cross-team aggregate';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-transparent">
      <DashboardHeader
        title="Team KPIs"
        subtitle={subtitle}
        searchPlaceholder="Search (not used on KPI view)"
        searchValue=""
        onSearchChange={() => {}}
        alwaysShowFilters
        period={period}
        onPeriodChange={setPeriod}
        periodOptions={['1M', '3M', '6M', 'YTD', '1Y', 'ALL']}
        filters={[
          {
            id: 'client-dept',
            icon: Building2,
            label: 'Client Department',
            options: CLIENT_DEPT_OPTIONS,
            value: clientDepts,
            onChange: (v) => setClientDepts(Array.isArray(v) ? v : []),
            multiSelect: true,
          },
          {
            id: 'intake',
            icon: Inbox,
            label: 'Intake Type',
            options: INTAKE_OPTIONS,
            value: intakeTypes,
            onChange: (v) => setIntakeTypes(Array.isArray(v) ? v : []),
            multiSelect: true,
          },
        ]}
        rightContent={
          <div className="flex items-center gap-3">
            {isLoading && (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading…
              </span>
            )}
            <span className="text-xs uppercase tracking-wider text-muted font-medium">Scope</span>
            <ScopeSelector value={scope} onChange={setScope} />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {data ? (
          <>
            <HeroKPICards heroKpis={data.heroKpis} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <ClientDeptChart data={data.clientDepts} />
              <NnaConcentrationCard data={data.nnaConcentration} />
            </div>

            <JourneyExplorer sankey={data.journeySankey} templates={data.journeyTemplates} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <StaleEngagementsTable
                data={data.staleEngagements}
                staleThreshold={staleThreshold}
                onStaleThresholdChange={setStaleThreshold}
              />
              <DormantClientsTable data={data.dormantClients} />
            </div>
          </>
        ) : !isLoading ? (
          <div className="py-20 text-center text-muted">Failed to load KPI data.</div>
        ) : null}
      </div>
    </div>
  );
}
