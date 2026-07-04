/**
 * Mock data computation functions for the Client Interactions dashboard.
 * Used as a fallback when SQLITE_DIR is not set in the environment.
 */

import type { Engagement } from '../types/engagements';
import type {
  EngagementFilters,
  DashboardMetrics,
  DepartmentBreakdown,
  ContributionDataResponse,
  EngagementsResponse,
  FilterOptions,
} from './client-interactions';
import {
  engagements as mockEngagements,
  generateContributionData,
  teamMemberOffices,
} from '../data/engagements';

// =============================================================================
// FILTER APPLICATION
// =============================================================================

// Mock data spans Jan 2023 – Jan 2025; use Jan 28 2025 as the fixed reference date
const MOCK_REFERENCE_DATE = new Date('2025-01-28');

function getPeriodCutoffDate(period: string): Date | null {
  const ref = MOCK_REFERENCE_DATE;
  switch (period) {
    case '1W': return new Date(ref.getTime() - 7 * 86400000);
    case '1M': return new Date(ref.getFullYear(), ref.getMonth() - 1, ref.getDate());
    case '3M': return new Date(ref.getFullYear(), ref.getMonth() - 3, ref.getDate());
    case '6M': return new Date(ref.getFullYear(), ref.getMonth() - 6, ref.getDate());
    case 'YTD': return new Date(ref.getFullYear(), 0, 1);
    case '1Y': return new Date(ref.getFullYear() - 1, ref.getMonth(), ref.getDate());
    case 'ALL': return null;
    default: return new Date(ref.getFullYear() - 1, ref.getMonth(), ref.getDate());
  }
}

function getPeriodDates(period: string) {
  const ref = MOCK_REFERENCE_DATE;
  switch (period) {
    case '1W': {
      const currentStart = new Date(ref.getTime() - 7 * 86400000);
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(previousEnd.getTime() - 7 * 86400000);
      return { currentStart, previousStart, previousEnd, label: 'vs prev week' };
    }
    case '1M': {
      const currentStart = new Date(ref.getFullYear(), ref.getMonth() - 1, ref.getDate());
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(ref.getFullYear(), ref.getMonth() - 2, ref.getDate());
      return { currentStart, previousStart, previousEnd, label: 'vs prev month' };
    }
    case '3M': {
      const currentStart = new Date(ref.getFullYear(), ref.getMonth() - 3, ref.getDate());
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(ref.getFullYear(), ref.getMonth() - 6, ref.getDate());
      return { currentStart, previousStart, previousEnd, label: 'vs prev 3M' };
    }
    case '6M': {
      const currentStart = new Date(ref.getFullYear(), ref.getMonth() - 6, ref.getDate());
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(ref.getFullYear(), ref.getMonth() - 12, ref.getDate());
      return { currentStart, previousStart, previousEnd, label: 'vs prev 6M' };
    }
    case 'YTD': {
      const currentStart = new Date(ref.getFullYear(), 0, 1);
      const previousEnd = new Date(ref.getFullYear() - 1, ref.getMonth(), ref.getDate());
      const previousStart = new Date(ref.getFullYear() - 1, 0, 1);
      return { currentStart, previousStart, previousEnd, label: 'vs prev YTD' };
    }
    case 'ALL': {
      return { currentStart: new Date(2000, 0, 1), previousStart: new Date(1990, 0, 1), previousEnd: new Date(1999, 11, 31), label: 'All Time' };
    }
    case '1Y':
    default: {
      const currentStart = new Date(ref.getFullYear() - 1, ref.getMonth(), ref.getDate());
      const previousEnd = new Date(currentStart.getTime() - 1);
      const previousStart = new Date(ref.getFullYear() - 2, ref.getMonth(), ref.getDate());
      return { currentStart, previousStart, previousEnd, label: 'YoY' };
    }
  }
}

export function applyMockFilters(engagements: Engagement[], filters: EngagementFilters): Engagement[] {
  let filtered = [...engagements];

  if (filters.period) {
    const cutoff = getPeriodCutoffDate(filters.period);
    if (cutoff) {
      filtered = filtered.filter(e => new Date(e.dateStarted) >= cutoff!);
    }
  }

  if (filters.teamMember && filters.teamMember !== 'All Team Members') {
    if (filters.teamMember === 'Office A') {
      filtered = filtered.filter(e => e.teamMembers.some(m => teamMemberOffices[m] === 'Office A'));
    } else if (filters.teamMember === 'Office B') {
      filtered = filtered.filter(e => e.teamMembers.some(m => teamMemberOffices[m] === 'Office B'));
    } else {
      filtered = filtered.filter(e => e.teamMembers.includes(filters.teamMember!));
    }
  }

  if (filters.departments && filters.departments.length > 0) {
    filtered = filtered.filter(e => filters.departments!.includes(e.internalClient.clientDept));
  }

  if (filters.intakeTypes && filters.intakeTypes.length > 0) {
    filtered = filtered.filter(e => filters.intakeTypes!.includes(e.intakeType));
  }

  if (filters.projectTypes && filters.projectTypes.length > 0) {
    filtered = filtered.filter(e => filters.projectTypes!.includes(e.type));
  }

  if (filters.status) {
    filtered = filtered.filter(e => e.status === filters.status);
  }

  if (filters.search) {
    const s = filters.search.toLowerCase();
    filtered = filtered.filter(e =>
      (e.externalClient?.toLowerCase().includes(s) ?? false) ||
      (e.clientCrn?.toLowerCase().includes(s) ?? false) ||
      e.internalClient.name.toLowerCase().includes(s) ||
      e.intakeType.toLowerCase().includes(s) ||
      e.type.toLowerCase().includes(s) ||
      e.internalClient.clientDept.toLowerCase().includes(s) ||
      e.teamMembers.some(m => teamMemberOffices[m]?.toLowerCase().includes(s))
    );
  }

  return filtered;
}

// =============================================================================
// METRICS
// =============================================================================

export function getMockMetrics(filters: EngagementFilters): DashboardMetrics {
  const period = filters.period || '1Y';
  const filtered = applyMockFilters(mockEngagements, { ...filters, period });
  const periodDates = getPeriodDates(period);

  const serfAndIrqs = filtered.filter(e => e.intakeType === 'SERF' || e.intakeType === 'IRQ');
  const clientProjects = serfAndIrqs.filter(e => e.type !== 'PCR').length;

  const prevPeriodSerfAndIrqs = mockEngagements.filter(e => {
    const d = new Date(e.dateStarted);
    return (e.intakeType === 'SERF' || e.intakeType === 'IRQ') &&
      d >= periodDates.previousStart && d <= periodDates.previousEnd;
  });
  const prevClientProjects = prevPeriodSerfAndIrqs.filter(e => e.type !== 'PCR').length;
  const clientProjectsChangePercent = prevClientProjects > 0
    ? Math.round(((clientProjects - prevClientProjects) / prevClientProjects) * 100)
    : clientProjects > 0 ? 100 : 0;

  const nonPcrProjects = serfAndIrqs.filter(e => e.type !== 'PCR');
  const irqCount = nonPcrProjects.filter(e => e.intakeType === 'IRQ').length;
  const serfCount = nonPcrProjects.filter(e => e.intakeType === 'SERF').length;
  const totalProjects = irqCount + serfCount;
  const eligibleForPortfolio = filtered.filter(e =>
    (e.intakeType === 'SERF' || e.intakeType === 'IRQ') && e.type !== 'PCR'
  );
  const portfoliosLogged = eligibleForPortfolio.filter(e => e.portfolioLogged).length;

  const adHocEngagements = filtered.filter(e => e.intakeType === 'Ad-Hoc');
  const adHoc = adHocEngagements.length;
  const prevAdHoc = mockEngagements.filter(e => {
    const d = new Date(e.dateStarted);
    return e.intakeType === 'Ad-Hoc' && d >= periodDates.previousStart && d <= periodDates.previousEnd;
  }).length;
  const adHocChangePercent = prevAdHoc > 0
    ? Math.round(((adHoc - prevAdHoc) / prevAdHoc) * 100)
    : adHoc > 0 ? 100 : 0;

  const intakeCounts: Record<string, number> = { 'In-Person': 0, 'Email': 0, 'Teams': 0 };
  adHocEngagements.forEach(e => {
    if (e.adHocChannel && e.adHocChannel in intakeCounts) intakeCounts[e.adHocChannel]++;
  });
  const INTAKE_COLORS: Record<string, string> = { 'In-Person': '#a5f3fc', 'Email': '#22d3ee', 'Teams': '#0e7490' };

  const inProgress = filtered.filter(e => e.status === 'In Progress').length;
  const baseInProgress = Math.max(inProgress - 3, 5);
  const sparklineData = Array.from({ length: 8 }, (_, i) => ({
    value: baseInProgress + Math.floor(Math.random() * 4) + (i < 4 ? 0 : Math.floor(i / 2))
  }));
  sparklineData[7] = { value: inProgress };

  const totalNNA = filtered.reduce((sum, e) => sum + (e.nna || 0), 0);
  const nnaProjectCount = filtered.filter(e => e.nna && e.nna > 0).length;
  const nnaEngagements = filtered.filter(e => e.nna && e.nna > 0);
  const prevNNA = mockEngagements.filter(e => {
    const d = new Date(e.dateStarted);
    return d >= periodDates.previousStart && d <= periodDates.previousEnd;
  }).reduce((sum, e) => sum + (e.nna || 0), 0);
  const nnaChangePercent = prevNNA > 0
    ? Math.round(((totalNNA - prevNNA) / prevNNA) * 100)
    : totalNNA > 0 ? 100 : 0;

  return {
    clientProjects: {
      count: clientProjects,
      changePercent: clientProjectsChangePercent,
      periodLabel: periodDates.label,
      intakeSourceBreakdown: {
        irqCount,
        irqPercent: totalProjects > 0 ? Math.round((irqCount / totalProjects) * 100) : 0,
        irqColor: '#3b82f6',
        serfCount,
        serfPercent: totalProjects > 0 ? Math.round((serfCount / totalProjects) * 100) : 0,
        serfColor: '#10b981',
        portfoliosLogged,
        portfoliosTotal: eligibleForPortfolio.length,
        portfoliosPercent: eligibleForPortfolio.length > 0 ? Math.round((portfoliosLogged / eligibleForPortfolio.length) * 100) : 0,
      },
    },
    adHoc: {
      count: adHoc,
      changePercent: adHocChangePercent,
      periodLabel: periodDates.label,
      intakeBreakdown: Object.entries(intakeCounts).map(([intake, count]) => ({
        intake,
        count,
        percent: adHoc > 0 ? Math.round((count / adHoc) * 100) : 0,
        color: INTAKE_COLORS[intake] || '#71717a',
      })),
    },
    inProgress: {
      count: inProgress,
      change: inProgress - sparklineData[6].value,
      sparklineData,
    },
    nna: {
      total: totalNNA,
      projectCount: nnaProjectCount,
      changePercent: nnaChangePercent,
      tiers: [
        { label: '<$50M', count: nnaEngagements.filter(e => e.nna! < 50_000_000).length, color: '#0e7490' },
        { label: '$50-200M', count: nnaEngagements.filter(e => e.nna! >= 50_000_000 && e.nna! < 200_000_000).length, color: '#22d3ee' },
        { label: '$200M+', count: nnaEngagements.filter(e => e.nna! >= 200_000_000).length, color: '#39FF14' },
      ],
    },
  };
}

// =============================================================================
// DEPARTMENT BREAKDOWN
// =============================================================================

export function getMockDepartmentBreakdown(filters: EngagementFilters): DepartmentBreakdown {
  const filtered = applyMockFilters(mockEngagements, filters);
  const deptCounts: Record<string, number> = { Advisory: 0, 'Brokerage': 0, Institutional: 0 };
  filtered.forEach(e => { deptCounts[e.internalClient.clientDept]++; });
  const total = filtered.length || 1;
  const colors: Record<string, string> = { Advisory: '#a5f3fc', 'Brokerage': '#22d3ee', Institutional: '#0e7490' };
  return {
    departments: Object.entries(deptCounts).map(([name, count]) => ({
      name,
      value: Math.round((count / total) * 100),
      count,
      color: colors[name] || '#71717a',
    })),
    total: filtered.length,
  };
}

// =============================================================================
// CONTRIBUTION DATA
// =============================================================================

export function getMockContributionData(filters: EngagementFilters): ContributionDataResponse {
  const filtered = applyMockFilters(mockEngagements, filters);
  const weeks = generateContributionData(filtered);
  let maxCount = 0;
  let totalDays = 0;
  weeks.forEach(week => week.forEach(day => {
    totalDays++;
    if (day.count > maxCount) maxCount = day.count;
  }));
  return { weeks, totalDays, maxCount };
}

// =============================================================================
// ENGAGEMENTS LIST
// =============================================================================

export function getMockEngagementsList(filters: EngagementFilters): EngagementsResponse {
  const filtered = applyMockFilters(mockEngagements, filters);

  // Resolve a sort column name to the value on an engagement. Handles nested
  // fields (internalClient name) and the JSON-array teamMembers (first member).
  const valueFor = (e: Engagement, column: string): string | number | boolean | undefined => {
    switch (column) {
      case 'internalClient': return e.internalClient.name;
      case 'teamMembers': return e.teamMembers[0];
      case 'portfolioLogged': return e.portfolioLogged;
      default: return e[column as keyof Engagement] as string | number | undefined;
    }
  };

  const sorted = [...filtered];
  const sortBy = filters.sortBy ?? [];
  if (sortBy.length > 0) {
    sorted.sort((a, b) => {
      for (const { column, direction } of sortBy) {
        const dir = direction === 'asc' ? 1 : -1;
        const aVal = valueFor(a, column);
        const bVal = valueFor(b, column);
        if (aVal === bVal) continue;
        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;
        if (typeof aVal === 'string' && typeof bVal === 'string') return aVal.localeCompare(bVal) * dir;
        if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir;
        if (typeof aVal === 'boolean' && typeof bVal === 'boolean') return (Number(aVal) - Number(bVal)) * dir;
      }
      return 0;
    });
  }

  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const startIndex = (page - 1) * pageSize;
  const paginated = sorted.slice(startIndex, startIndex + pageSize);

  return {
    engagements: paginated,
    total: filtered.length,
    page,
    pageSize,
    hasMore: startIndex + pageSize < filtered.length,
  };
}

// =============================================================================
// FILTER OPTIONS
// =============================================================================

export function getMockFilterOptions(): FilterOptions {
  const departments = new Set<string>();
  const intakeTypes = new Set<string>();
  const projectTypes = new Set<string>();
  const statuses = new Set<string>();

  mockEngagements.forEach(e => {
    departments.add(e.internalClient.clientDept);
    intakeTypes.add(e.intakeType);
    projectTypes.add(e.type);
    statuses.add(e.status);
  });

  return {
    teamMembers: ['All Team Members', 'Office B', 'Office A'],
    teamMemberGroups: [{ label: 'Office', options: ['Office B', 'Office A'] }],
    departments: Array.from(departments).sort(),
    intakeTypes: ['IRQ', 'SERF', 'Ad-Hoc'].filter(t => intakeTypes.has(t)),
    projectTypes: Array.from(projectTypes).sort(),
    statuses: Array.from(statuses).sort(),
  };
}
