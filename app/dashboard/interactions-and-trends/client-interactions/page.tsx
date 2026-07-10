'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Building2, Download, User, Loader2, Inbox, Briefcase, CircleDot } from 'lucide-react';
import MetricCards from '@/app/components/dashboard/interactions-and-trends/client-interactions/MetricCards';
import ContributionGraph from '@/app/components/dashboard/interactions-and-trends/client-interactions/ContributionGraph';
import DepartmentChart from '@/app/components/dashboard/interactions-and-trends/client-interactions/DepartmentChart';
import InteractionsTable from '@/app/components/dashboard/interactions-and-trends/client-interactions/InteractionsTable';
import NewInteractionForm, { InteractionFormData, EditingEngagement } from '@/app/components/dashboard/interactions-and-trends/client-interactions/NewInteractionForm';
import BulkUploadModal from '@/app/components/dashboard/interactions-and-trends/client-interactions/BulkUploadModal';
import {
  getDashboardData,
  createEngagement,
  updateEngagement,
  deleteEngagement,
  updateEngagementStatus,
  updateEngagementNNA,
  assignEngagement,
  addEngagementNote,
  attributeClientModels,
  exportEngagements,
  ConflictError,
} from '@/app/lib/api/client-interactions';
import type { DashboardData, DashboardMetrics, EngagementFilters, SortSpec } from '@/app/lib/api/client-interactions';
import type { EngagementMetric, Engagement } from '@/app/lib/types/engagements';
import DashboardHeader from '@/app/components/dashboard/shared/DashboardHeader';
import { useCurrentUser } from '@/app/lib/auth/context';
import { toDisplayName, isReadOnlyUser, canUserEditEngagement } from '@/app/lib/auth/types';
import { useDashboardChanges } from '@/app/lib/hooks/useDashboardChanges';

// =============================================================================
// HELPERS
// =============================================================================

function formatNNA(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1000) return `$${(v / 1000).toFixed(0)}K`;
  return `$${v}`;
}

function pct(n: number): string {
  return n >= 0 ? `+${n}%` : `${n}%`;
}

/** Maps the server's pre-computed DashboardMetrics to the EngagementMetric[] shape MetricCards expects. */
function toMetricCards(metrics: DashboardMetrics): EngagementMetric[] {
  return [
    {
      label: 'Client Projects',
      sublabel: metrics.clientProjects.periodLabel,
      value: metrics.clientProjects.count.toLocaleString(),
      change: pct(metrics.clientProjects.changePercent),
      isPositive: metrics.clientProjects.changePercent >= 0,
      icon: 'FileText',
      intakeSourceBreakdown: metrics.clientProjects.intakeSourceBreakdown,
    },
    {
      label: 'Ad-Hoc',
      sublabel: metrics.adHoc.periodLabel,
      value: metrics.adHoc.count.toLocaleString(),
      change: pct(metrics.adHoc.changePercent),
      isPositive: metrics.adHoc.changePercent >= 0,
      icon: 'MessageSquare',
      intakeBreakdown: metrics.adHoc.intakeBreakdown,
    },
    {
      label: 'In Progress',
      sublabel: 'vs prev week',
      value: metrics.inProgress.count.toLocaleString(),
      change: metrics.inProgress.change >= 0 ? `+${metrics.inProgress.change}` : `${metrics.inProgress.change}`,
      isPositive: metrics.inProgress.change >= 0,
      icon: 'PlayCircle',
      sparklineData: metrics.inProgress.sparklineData,
    },
    {
      label: 'NNA',
      sublabel: `${metrics.nna.projectCount} projects`,
      value: formatNNA(metrics.nna.total),
      change: pct(metrics.nna.changePercent),
      isPositive: metrics.nna.changePercent >= 0,
      icon: 'DollarSign',
      nnaTiers: metrics.nna.tiers,
    },
  ];
}


function formatDisplayDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseISODate(dateStr: string): string {
  if (dateStr === '—') {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// =============================================================================
// COMPONENT
// =============================================================================

// Short label for the active period filter, shown on the chart cards so the
// window they display is never mistaken for a fixed range.
const PERIOD_LABELS: Record<string, string> = {
  '1W': '1W', '1M': '1M', '3M': '3M', '6M': '6M', 'YTD': 'YTD', '1Y': '1Y', 'ALL': 'All',
};

export default function EngagementsDashboard() {
  const { user } = useCurrentUser();
  const readOnly = isReadOnlyUser(user);
  const isGuest = user?.team === 'Guest';
  // Cross-team aggregate ("All Teams") is only visible to users whose server-side
  // constraint allows it — admins, Leadership, and Guests are not pinned to a single team.
  const canSeeAllTeams = user?.role === 'admin' || user?.team === 'Leadership' || isGuest;
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Global filter state
  const [teamMemberFilter, setTeamMemberFilter] = useState('All Team Members');
  const [departmentFilter, setDepartmentFilter] = useState<string[]>([]);
  const [intakeTypeFilter, setIntakeTypeFilter] = useState<string[]>([]);
  // Default view excludes PCRs — users can click 'All Project Types' in the filter
  // to clear this and see everything, including PCRs.
  const [projectTypeFilter, setProjectTypeFilter] = useState<string[]>([
    'Meeting',
    'Discovery Meeting',
    'Data Request',
    'Data Update',
    'Other',
    'Follow-up Material',
    'Follow-up Meeting',
  ]);
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [period, setPeriod] = useState('1Y');
  // Multi-column sort. Order is ORDER BY priority (first entry = primary).
  // Default surfaces unfinished projects first (date_finished DESC NULLS FIRST),
  // ordered within each bucket by most-recently-created (date_started DESC).
  const [sortBy, setSortBy] = useState<SortSpec[]>([
    { column: 'dateFinished', direction: 'desc' },
    { column: 'dateStarted', direction: 'desc' },
  ]);

  const [isExporting, setIsExporting] = useState(false);

  // Form state
  const [isNewInteractionOpen, setIsNewInteractionOpen] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [editingEngagement, setEditingEngagement] = useState<EditingEngagement | null>(null);
  const [editingEngagementNoteCount, setEditingEngagementNoteCount] = useState<number>(0);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const conflictTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Flip card state
  const [flippedCard, setFlippedCard] = useState<string | null>(null);
  const flipTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const flipStartTimeRef = useRef<number>(0);
  const lastFilterChangeRef = useRef<number>(0);

  const handleFilterChange = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    lastFilterChangeRef.current = Date.now();
    setter(value);
  }, []);

  const handleCardEnter = useCallback((cardLabel: string) => {
    if (Date.now() - lastFilterChangeRef.current < 1000) return;
    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = null;
    }
    flipStartTimeRef.current = Date.now();
    setFlippedCard(cardLabel);
  }, []);

  const handleCardLeave = useCallback(() => {
    const remaining = Math.max(0, 1000 - (Date.now() - flipStartTimeRef.current));
    flipTimeoutRef.current = setTimeout(() => {
      setFlippedCard(null);
      flipTimeoutRef.current = null;
    }, remaining);
  }, []);

  // Guests don't have "Team Members" — their only scope is the cross-team aggregate.
  // Switch the default once the user identity resolves.
  useEffect(() => {
    if (isGuest && teamMemberFilter === 'All Team Members') {
      setTeamMemberFilter('All Teams');
    }
  }, [isGuest, teamMemberFilter]);

  // -------------------------------------------------------------------------
  // Data loading — fires on mount and whenever any filter/search changes
  // -------------------------------------------------------------------------
  const currentUser = user ? toDisplayName(user.firstName, user.lastName) : 'All Team Members';

  useEffect(() => {
    const controller = new AbortController();
    const filters: EngagementFilters = {
      period,
      teamMember: (teamMemberFilter === 'All Team Members' || teamMemberFilter === 'All Teams') ? undefined : teamMemberFilter,
      departments: departmentFilter.length > 0 ? departmentFilter : undefined,
      intakeTypes: intakeTypeFilter.length > 0 ? intakeTypeFilter : undefined,
      projectTypes: projectTypeFilter.length > 0 ? projectTypeFilter : undefined,
      status: statusFilter !== 'All Statuses' ? statusFilter : undefined,
      search: searchQuery || undefined,
      pageSize: 200,
      sortBy,
    };

    const delay = searchQuery ? 300 : 0;
    const id = setTimeout(async () => {
      setIsLoading(true);
      try {
        const data = await getDashboardData(filters, controller.signal);
        setDashboardData(data);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        console.error('Failed to load dashboard data:', err);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, delay);

    return () => { clearTimeout(id); controller.abort(); };
  }, [period, teamMemberFilter, departmentFilter, intakeTypeFilter, projectTypeFilter, statusFilter, searchQuery, sortBy]);

  // Re-fetch with current filters (used after mutations)
  const reloadData = useCallback(async () => {
    const filters: EngagementFilters = {
      period,
      teamMember: (teamMemberFilter === 'All Team Members' || teamMemberFilter === 'All Teams') ? undefined : teamMemberFilter,
      departments: departmentFilter.length > 0 ? departmentFilter : undefined,
      intakeTypes: intakeTypeFilter.length > 0 ? intakeTypeFilter : undefined,
      projectTypes: projectTypeFilter.length > 0 ? projectTypeFilter : undefined,
      status: statusFilter !== 'All Statuses' ? statusFilter : undefined,
      search: searchQuery || undefined,
      pageSize: 200,
      sortBy,
    };
    try {
      setDashboardData(await getDashboardData(filters));
    } catch (err) {
      console.error('Failed to reload dashboard data:', err);
    }
  }, [period, teamMemberFilter, departmentFilter, intakeTypeFilter, projectTypeFilter, statusFilter, searchQuery, sortBy]);

  // SSE connection — reloads dashboard whenever any user mutates an engagement
  useEffect(() => {
    const es = new EventSource('/api/client-interactions/events');
    es.onmessage = (e) => {
      if (e.data !== 'connected') reloadData();
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [reloadData]);

  // Click without shift: replace the entire sort with this column (cycle asc → desc → cleared).
  // Shift+click: extend the sort. If the column is already in the sort, cycle its direction
  //              (asc → desc → removed); otherwise append it as a new ascending tier.
  const handleSort = useCallback((column: string, shift: boolean) => {
    setSortBy(prev => {
      const idx = prev.findIndex(s => s.column === column);
      if (!shift) {
        // Reset to a single-column sort. If clicking the only currently-active
        // sort column, cycle its direction; otherwise start fresh on asc.
        if (prev.length === 1 && idx === 0) {
          if (prev[0].direction === 'asc') return [{ column, direction: 'desc' }];
          return [];
        }
        return [{ column, direction: 'asc' }];
      }
      // Shift: append or cycle on the existing entry, leaving the others alone.
      if (idx === -1) return [...prev, { column, direction: 'asc' }];
      const next = [...prev];
      if (next[idx].direction === 'asc') {
        next[idx] = { column, direction: 'desc' };
        return next;
      }
      next.splice(idx, 1);
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const filters: EngagementFilters = {
        period,
        teamMember: (teamMemberFilter === 'All Team Members' || teamMemberFilter === 'All Teams') ? undefined : teamMemberFilter,
        departments: departmentFilter.length > 0 ? departmentFilter : undefined,
        intakeTypes: intakeTypeFilter.length > 0 ? intakeTypeFilter : undefined,
        projectTypes: projectTypeFilter.length > 0 ? projectTypeFilter : undefined,
        status: statusFilter !== 'All Statuses' ? statusFilter : undefined,
        search: searchQuery || undefined,
      };
      const blob = await exportEngagements(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `engagements-export-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [period, teamMemberFilter, departmentFilter, intakeTypeFilter, projectTypeFilter, statusFilter, searchQuery]);

  // -------------------------------------------------------------------------
  // Derived display data
  // -------------------------------------------------------------------------
  const metricCards = useMemo(
    () => dashboardData ? toMetricCards(dashboardData.metrics) : [],
    [dashboardData]
  );
  const departments = useMemo(() => dashboardData?.departments.departments ?? [], [dashboardData]);
  const contributionWeeks = useMemo(() => dashboardData?.contributionData.weeks ?? [], [dashboardData]);
  const engagements = useMemo(() => dashboardData?.engagements.engagements ?? [], [dashboardData]);
  const filterOptions = dashboardData?.filterOptions;

  // Realtime flash tokens — diffs each dashboardData snapshot against the previous one.
  // filtersKey must include every filter/sort dep so filter changes reset the diff baseline.
  const filtersKey = useMemo(
    () => JSON.stringify([
      period, teamMemberFilter, departmentFilter, intakeTypeFilter,
      projectTypeFilter, statusFilter, searchQuery, sortBy,
    ]),
    [period, teamMemberFilter, departmentFilter, intakeTypeFilter, projectTypeFilter, statusFilter, searchQuery, sortBy],
  );
  const dashboardChanges = useDashboardChanges(dashboardData, filtersKey);

  // -------------------------------------------------------------------------
  // CRUD handlers
  // -------------------------------------------------------------------------
  const handleNewInteraction = async (data: InteractionFormData) => {
    try {
      const newEngagement = await createEngagement({
        clientCrn: data.clientCrn,
        externalClient: data.externalClient,
        internalClient: { name: data.internalClient, clientDept: data.internalClientDept as 'Advisory' | 'Brokerage' | 'Institutional' },
        intakeType: data.intakeType as 'IRQ' | 'SERF' | 'Ad-Hoc',
        adHocChannel: data.adHocChannel,
        type: data.projectType,
        projectId: data.projectId,
        teamMembers: data.teamMembers,
        department: data.internalClientDept as 'Advisory' | 'Brokerage' | 'Institutional',
        dateStarted: formatDisplayDate(data.dateStarted),
        dateFinished: data.dateFinished ? formatDisplayDate(data.dateFinished) : '—',
        status: data.status ?? 'In Progress',
        portfolioLogged: data.portfolioLogged,
        portfolio: data.portfolio,
        nna: data.nna || undefined,
        notes: data.notes?.trim() || undefined,
        tickersMentioned: data.tickersMentioned?.length ? data.tickersMentioned : undefined,
        linkedFromId: data.linkedFromId ?? null,
      });
      if (data.notes?.trim()) {
        await addEngagementNote(newEngagement.id, data.notes.trim());
      }
      // Models logged from the form before this interaction existed are unattributed;
      // claim them now that it has an id. Scoped by CRN server-side, so ids left over
      // from a client the user switched away from are a no-op.
      if (data.pendingModelIds?.length) {
        await attributeClientModels(data.clientCrn, newEngagement.id, data.pendingModelIds);
      }
      await reloadData();
    } catch (err) {
      console.error('Failed to create engagement:', err);
    }
  };

  // Optimistic updates for fast inline table edits
  const patchEngagements = (patch: (e: Engagement) => Engagement, id: number) => {
    setDashboardData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        engagements: {
          ...prev.engagements,
          engagements: prev.engagements.engagements.map(e => e.id === id ? patch(e) : e),
        },
      };
    });
  };

  const handleStatusChange = (engagementId: number, newStatus: string) => {
    const target = engagements.find(e => e.id === engagementId);
    if (!target || !canUserEditEngagement(user, target.teamMembers)) return;
    // Completing an interaction with no finish date defaults it to today (mirrors the
    // server). Optimistically show today now, then reconcile with the server's value.
    const autoFinish = newStatus === 'Completed' && (!target.dateFinished || target.dateFinished === '—');
    patchEngagements(e => ({
      ...e,
      status: newStatus,
      dateFinished: autoFinish ? formatDisplayDate(parseISODate('—')) : e.dateFinished,
    }), engagementId);
    updateEngagementStatus(engagementId, newStatus)
      .then(res => patchEngagements(e => ({ ...e, dateFinished: res.dateFinished }), engagementId))
      .catch(console.error);
  };

  // Claim an unassigned interaction (one created by automation, or deliberately left
  // unstaffed). The server derives the engagement's team from the assignee, so this
  // also lifts the row out of the global inbox and into the claimer's team.
  const handleAssignSelf = (engagementId: number) => {
    const target = engagements.find(e => e.id === engagementId);
    if (!user || !target || target.teamMembers.length > 0) return;
    const me = toDisplayName(user.firstName, user.lastName);
    patchEngagements(e => ({ ...e, teamMembers: [me] }), engagementId);
    assignEngagement(engagementId, [me]).catch(err => {
      console.error(err);
      // Roll the optimistic claim back — someone else likely took it first.
      patchEngagements(e => ({ ...e, teamMembers: [] }), engagementId);
      reloadData();
    });
  };

  const handleNoteAdded = (engagementId: number) => {
    patchEngagements(e => ({ ...e, noteCount: (e.noteCount ?? 0) + 1 }), engagementId);
  };

  const handleNoteDeleted = (engagementId: number) => {
    patchEngagements(e => ({ ...e, noteCount: Math.max(0, (e.noteCount ?? 0) - 1) }), engagementId);
  };

  const handleFilepathSaved = (engagementId: number, filepath: string | null) => {
    patchEngagements(e => ({ ...e, filepath }), engagementId);
  };

  const handleNNAChange = (engagementId: number, nna: number | undefined) => {
    const target = engagements.find(e => e.id === engagementId);
    if (!target || !canUserEditEngagement(user, target.teamMembers)) return;
    patchEngagements(e => ({ ...e, nna }), engagementId);
    updateEngagementNNA(engagementId, nna).catch(console.error);
  };

  const handleRowClick = (engagement: Engagement) => {
    if (!canUserEditEngagement(user, engagement.teamMembers)) return;
    setEditingEngagement({
      id: engagement.id,
      data: {
        clientCrn: engagement.clientCrn,
        clientCrnPending: engagement.crnPending ?? false,
        externalClient: engagement.externalClient,
        internalClient: engagement.internalClient.name,
        internalClientDept: engagement.internalClient.clientDept,
        intakeType: engagement.intakeType,
        adHocChannel: engagement.adHocChannel,
        projectType: engagement.type,
        projectId: engagement.projectId ?? '',
        teamMembers: engagement.teamMembers,
        dateStarted: parseISODate(engagement.dateStarted),
        dateFinished: engagement.dateFinished && engagement.dateFinished !== '—'
          ? parseISODate(engagement.dateFinished)
          : undefined,
        status: engagement.status,
        notes: engagement.notes || '',
        portfolioLogged: engagement.portfolioLogged,
        portfolio: engagement.portfolio,
        nna: engagement.nna || null,
        tickersMentioned: engagement.tickersMentioned || [],
        linkedFromId: engagement.linkedFromId ?? null,
        linkedFromPreview: null,
      },
      originalDateStarted: engagement.dateStarted,
      originalDateFinished: engagement.dateFinished,
      version: engagement.version,
      createdById: engagement.createdById,
      filepath: engagement.filepath,
    });
    setEditingEngagementNoteCount(engagement.noteCount ?? 0);
    setIsNewInteractionOpen(true);
  };

  const handleUpdateInteraction = async (engagementId: number, data: InteractionFormData) => {
    const dateStartedChanged = editingEngagement?.data.dateStarted !== data.dateStarted;
    const dateFinishedChanged = editingEngagement?.data.dateFinished !== data.dateFinished;
    const originalDateStarted = editingEngagement?.originalDateStarted;
    const originalDateFinished = editingEngagement?.originalDateFinished;
    const version = editingEngagement?.version;

    setEditingEngagement(null);
    try {
      await updateEngagement(engagementId, {
        clientCrn: data.clientCrn,
        internalClient: { name: data.internalClient, clientDept: data.internalClientDept as 'Advisory' | 'Brokerage' | 'Institutional' },
        intakeType: data.intakeType as 'IRQ' | 'SERF' | 'Ad-Hoc',
        adHocChannel: data.adHocChannel,
        type: data.projectType,
        // Sent as '' rather than undefined so clearing the field persists as NULL
        // (PATCH treats undefined as "leave unchanged").
        projectId: data.projectId ?? '',
        teamMembers: data.teamMembers,
        department: data.internalClientDept as 'Advisory' | 'Brokerage' | 'Institutional',
        dateStarted: dateStartedChanged ? formatDisplayDate(data.dateStarted) : (originalDateStarted || undefined),
        dateFinished: dateFinishedChanged
          ? (data.dateFinished ? formatDisplayDate(data.dateFinished) : '—')
          : (originalDateFinished || undefined),
        status: data.status,
        notes: data.notes || undefined,
        portfolioLogged: data.portfolioLogged,
        portfolio: data.portfolio,
        nna: data.nna ?? undefined,
        tickersMentioned: data.tickersMentioned?.length ? data.tickersMentioned : undefined,
        linkedFromId: data.linkedFromId ?? null,
        version,
      });
      await reloadData();
    } catch (err) {
      if (err instanceof ConflictError) {
        if (conflictTimeoutRef.current) clearTimeout(conflictTimeoutRef.current);
        setConflictError(err.message);
        conflictTimeoutRef.current = setTimeout(() => setConflictError(null), 6000);
      } else {
        console.error('Failed to update engagement:', err);
      }
    }
  };

  const handleCloseForm = () => {
    setIsNewInteractionOpen(false);
    setEditingEngagement(null);
    setEditingEngagementNoteCount(0);
  };

  const handleDelete = async (id: number) => {
    await deleteEngagement(id);
    await reloadData();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <>
      <NewInteractionForm
        isOpen={isNewInteractionOpen}
        onClose={handleCloseForm}
        onSubmit={handleNewInteraction}
        onUpdate={handleUpdateInteraction}
        onDelete={handleDelete}
        editingEngagement={editingEngagement}
        initialNoteCount={editingEngagementNoteCount}
        onNoteAdded={handleNoteAdded}
        onNoteDeleted={handleNoteDeleted}
        onFilepathSaved={handleFilepathSaved}
        onBulkUploadClick={() => setIsBulkUploadOpen(true)}
      />
      <BulkUploadModal
        isOpen={isBulkUploadOpen}
        onClose={() => setIsBulkUploadOpen(false)}
        onImportComplete={reloadData}
      />

      <DashboardHeader
        title="Client Interactions"
        subtitle="Log, track, and export client engagements"
        searchPlaceholder="Search external clients, internal clients, project ID..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        className="sticky top-0 z-10"
        filters={[
          ...(isGuest
            ? [{
                id: 'teamMember',
                icon: User,
                label: 'Team Member',
                options: ['All Teams'],
                value: teamMemberFilter,
                onChange: (v: string | string[]) => handleFilterChange(setTeamMemberFilter, v as string),
              }]
            : [{
                id: 'teamMember',
                icon: User,
                label: 'Team Member',
                options: filterOptions
                  ? [...filterOptions.teamMembers, currentUser, ...(canSeeAllTeams ? ['All Teams'] : [])]
                  : ['All Team Members', currentUser, ...(canSeeAllTeams ? ['All Teams'] : [])],
                optionGroups: [
                  ...(canSeeAllTeams ? [{ label: 'Scope', options: ['All Teams'] }] : []),
                  ...(filterOptions
                    ? [...filterOptions.teamMemberGroups, { label: 'Members', options: [currentUser] }]
                    : [{ label: 'Members', options: [currentUser] }]),
                ],
                value: teamMemberFilter,
                onChange: (v: string | string[]) => handleFilterChange(setTeamMemberFilter, v as string),
              }]),
          {
            id: 'department',
            icon: Building2,
            label: 'Department',
            options: ['All Departments', ...(filterOptions?.departments ?? [])],
            value: departmentFilter,
            onChange: (v: string | string[]) => handleFilterChange(setDepartmentFilter, v as string[]),
            multiSelect: true,
          },
          {
            id: 'intakeType',
            icon: Inbox,
            label: 'Intake Type',
            options: ['All Intake Types', ...(filterOptions?.intakeTypes ?? [])],
            value: intakeTypeFilter,
            onChange: (v: string | string[]) => handleFilterChange(setIntakeTypeFilter, v as string[]),
            multiSelect: true,
          },
          {
            id: 'projectType',
            icon: Briefcase,
            label: 'Project Type',
            options: ['All Project Types', ...(filterOptions?.projectTypes ?? [])],
            value: projectTypeFilter,
            onChange: (v: string | string[]) => handleFilterChange(setProjectTypeFilter, v as string[]),
            multiSelect: true,
          },
          {
            id: 'status',
            icon: CircleDot,
            label: 'Status',
            options: ['All Statuses', ...(filterOptions?.statuses ?? [])],
            value: statusFilter,
            onChange: (v: string | string[]) => handleFilterChange(setStatusFilter, v as string),
          },
        ]}
        period={period}
        onPeriodChange={(v: string) => handleFilterChange(setPeriod, v)}
        actionButtonLabel={readOnly ? undefined : '+ Interaction'}
        onActionButtonClick={readOnly ? undefined : () => setIsNewInteractionOpen(true)}
      />

      {conflictError && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-amber-900/40 border border-amber-700/60 text-amber-300 text-sm flex items-center justify-between gap-4">
          <span>{conflictError}</span>
          <button onClick={() => setConflictError(null)} className="text-amber-400 hover:text-amber-200 flex-shrink-0">✕</button>
        </div>
      )}

      <div className="p-6 flex flex-col gap-6">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-muted text-sm">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <>
            <MetricCards
              metrics={metricCards}
              flippedCard={flippedCard}
              onCardEnter={handleCardEnter}
              onCardLeave={handleCardLeave}
              metricChanges={dashboardChanges.metricChanges}
            />

            <div className="grid grid-cols-3 gap-4" style={{ height: '340px' }}>
              <div className="col-span-2 relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 h-full rounded-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <div className="relative z-10 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-3 flex-shrink-0">
                    <div>
                      <h3 className="text-sm font-medium text-white">Completed Interactions</h3>
                      <p className="text-xs text-muted">Daily completed projects & touch points ({PERIOD_LABELS[period] ?? period})</p>
                    </div>
                    <button className="p-1.5 bg-zinc-800/50 backdrop-blur-sm text-muted hover:text-cyan-400 transition-colors" title="Download chart data">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex-1" style={{ minHeight: 0 }}>
                    {contributionWeeks.length > 0 && <ContributionGraph data={contributionWeeks} contributionChanges={dashboardChanges.contributionChanges} />}
                  </div>
                </div>
              </div>

              <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 p-5 h-full rounded-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
                <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                <div className="relative z-10 h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <div>
                      <h3 className="text-sm font-medium text-white">Client Department</h3>
                      <p className="text-xs text-muted">Total projects ({PERIOD_LABELS[period] ?? period})</p>
                    </div>
                    <button className="p-1.5 bg-zinc-800/50 backdrop-blur-sm text-muted hover:text-cyan-400 transition-colors" title="Download chart data">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <DepartmentChart data={departments} departmentChanges={dashboardChanges.departmentChanges} />
                </div>
              </div>
            </div>

            <InteractionsTable
              engagements={engagements}
              sortBy={sortBy}
              onSort={handleSort}
              onStatusChange={handleStatusChange}
              onNoteAdded={handleNoteAdded}
              onNoteDeleted={handleNoteDeleted}
              onFilepathSaved={handleFilepathSaved}
              onNNAChange={handleNNAChange}
              onAssignSelf={handleAssignSelf}
              onRowClick={handleRowClick}
              onExport={handleExport}
              isExporting={isExporting}
              newRowIds={dashboardChanges.newRowIds}
              removedRowIds={dashboardChanges.removedRowIds}
              rowFieldChanges={dashboardChanges.rowFieldChanges}
              readOnly={readOnly}
              currentUser={user}
            />
          </>
        )}
      </div>
    </>
  );
}
