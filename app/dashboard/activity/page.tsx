'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Activity, Users, Wifi, RefreshCw, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/app/lib/auth/context';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

type Range = '24h' | '7d' | '30d';

interface StatsResponse {
  range: Range;
  users: { total: number; active: number; pending: number; inactive: number; signupsThisWeek: number };
  events: { today: number; yesterday: number };
  onlineNow: number;
  byEntity: { entityType: string | null; count: number }[];
  byAction: { action: string; count: number }[];
  byDay: { day: string; count: number }[];
  byDayByPage: { day: string; path: string; count: number }[];
  topUsers: { userName: string | null; userEmail: string | null; count: number }[];
}

interface LogRow {
  id: string;
  timestamp: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  userOffice: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}

function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

type BadgeTone = 'emerald' | 'red' | 'amber' | 'blue' | 'cyan' | 'grey';

const BADGE_STYLES: Record<BadgeTone, { badge: string; rowGradient: string }> = {
  emerald: {
    badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    rowGradient: 'bg-gradient-to-l from-emerald-500/35 from-0% to-transparent to-35%',
  },
  red: {
    badge: 'text-red-400 bg-red-500/10 border-red-500/20',
    rowGradient: 'bg-gradient-to-l from-red-500/35 from-0% to-transparent to-35%',
  },
  amber: {
    badge: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    rowGradient: 'bg-gradient-to-l from-amber-500/35 from-0% to-transparent to-35%',
  },
  blue: {
    badge: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    rowGradient: 'bg-gradient-to-l from-blue-500/35 from-0% to-transparent to-35%',
  },
  cyan: {
    badge: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    rowGradient: 'bg-gradient-to-l from-cyan-500/35 from-0% to-transparent to-35%',
  },
  grey: {
    badge: 'text-muted bg-zinc-500/10 border-zinc-500/20',
    rowGradient: 'bg-gradient-to-l from-zinc-500/35 from-0% to-transparent to-35%',
  },
};

function actionBadge(action: string): { label: string; tone: BadgeTone } {
  if (action.endsWith('.create') || action === 'engagement.bulk_upload' || action === 'auth.signup') {
    return { label: 'Created', tone: 'emerald' };
  }
  if (action.endsWith('.delete')) return { label: 'Deleted', tone: 'red' };
  if (action.endsWith('.update') || action.endsWith('_change')) return { label: 'Updated', tone: 'amber' };
  if (action === 'engagement.export') return { label: 'Exported', tone: 'blue' };
  if (action === 'kpi.report') return { label: 'Report', tone: 'blue' };
  if (action === 'auth.login') return { label: 'Login', tone: 'emerald' };
  if (action === 'auth.login_failed') return { label: 'Failed', tone: 'red' };
  if (action === 'auth.logout') return { label: 'Logout', tone: 'grey' };
  if (action === 'page.view') return { label: 'View', tone: 'grey' };
  return { label: action, tone: 'cyan' };
}

function interactionLabel(row: LogRow): string {
  const d = row.details;
  const client = typeof d?.internalClient === 'string' && d.internalClient ? (d.internalClient as string) : null;
  if (client) return `${client} interaction`;
  if (row.entityId) return `interaction #${row.entityId}`;
  return 'interaction';
}

function detailsSummary(row: LogRow): string {
  const d = row.details;
  const interaction = interactionLabel(row);

  switch (row.action) {
    case 'engagement.create': return `${interaction} created`;
    case 'engagement.update': return `${interaction} updated`;
    case 'engagement.delete': return `${interaction} deleted`;
    case 'engagement.status_change': {
      const status = typeof d?.status === 'string' ? d.status : 'status';
      return `${interaction} status → ${status}`;
    }
    case 'engagement.nna_change': {
      const nna = d?.nna;
      return `${interaction} NNA ${nna == null ? 'cleared' : `set to $${nna}`}`;
    }
    case 'engagement.bulk_upload': {
      const n = typeof d?.inserted === 'number' ? d.inserted : 0;
      return `${n} interaction${n === 1 ? '' : 's'} imported`;
    }
    case 'engagement.export': {
      const n = typeof d?.rowCount === 'number' ? d.rowCount : 0;
      return `${n} interaction${n === 1 ? '' : 's'} exported`;
    }
    case 'kpi.report': {
      const who = typeof d?.subject === 'string' ? d.subject : 'KPI';
      const period = typeof d?.period === 'string' ? ` · ${d.period}` : '';
      return `${who} report generated${period}`;
    }
    case 'note.create': return `Note added to ${interaction}`;
    case 'note.update': return `Note edited on ${interaction}`;
    case 'note.delete': return `Note deleted from ${interaction}`;
    case 'auth.login': return 'Signed in';
    case 'auth.login_failed':
      return typeof d?.reason === 'string' ? `Login failed · ${d.reason}` : 'Login failed';
    case 'auth.logout': return 'Signed out';
    case 'auth.signup': return 'Account created';
    case 'page.view':
      return typeof d?.path === 'string' ? `Viewed ${d.path}` : 'Viewed page';
    case 'user.update':
      return typeof d?.targetEmail === 'string' ? `${d.targetEmail} user updated` : 'User updated';
    case 'user.delete':
      return typeof d?.targetEmail === 'string' ? `${d.targetEmail} user deleted` : 'User deleted';
    case 'team_member.create':
      return typeof d?.displayName === 'string' ? `${d.displayName} team member created` : 'Team member created';
    case 'team_member.update':
      return typeof d?.displayName === 'string' ? `${d.displayName} team member updated` : 'Team member updated';
    default:
      return row.action;
  }
}

const ENTITY_COLORS: Record<string, string> = {
  interaction_created: '#34d399',
  interaction_updated: '#fbbf24',
  interaction_deleted: '#f87171',
  user: '#22d3ee',
  team_member: '#60a5fa',
  page: '#94a3b8',
  other: '#f59e0b',
};

const ENTITY_LABELS: Record<string, string> = {
  interaction_created: 'Interaction Created',
  interaction_updated: 'Interaction Updated',
  interaction_deleted: 'Interaction Deleted',
  user: 'User',
  team_member: 'Team Member',
  page: 'Page View',
  other: 'Other',
};

// Page-view buckets for the Activity by Page area chart.
// Add new buckets here as pages are finalized; unmatched paths fall through to "Other".
interface PageBucket {
  key: string;
  label: string;
  color: string;
  match: (path: string) => boolean;
}

const PAGE_BUCKETS: PageBucket[] = [
  {
    key: 'clientInteractions',
    label: 'Client Interactions',
    color: '#3b82f6',
    match: path => path.startsWith('/dashboard/interactions-and-trends/client-interactions'),
  },
  {
    key: 'other',
    label: 'Other',
    color: '#64748b',
    match: () => true,
  },
];

function bucketForPath(path: string): string {
  for (const b of PAGE_BUCKETS) if (b.match(path)) return b.key;
  return 'other';
}

function CardShell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 rounded-xl ${className}`}>
      {children}
    </div>
  );
}

function MetricCard({
  label,
  sublabel,
  value,
  delta,
  icon: Icon,
}: {
  label: string;
  sublabel?: string;
  value: string;
  delta?: { text: string; positive: boolean } | null;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <CardShell className="p-5 h-[140px] flex flex-col justify-between">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[0.75rem] uppercase tracking-wider text-muted font-medium">{label}</p>
          {sublabel && <p className="text-[0.7rem] text-muted/70 mt-0.5">{sublabel}</p>}
        </div>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600/20 to-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
          <Icon className="w-4 h-4 text-cyan-400" />
        </div>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-[2.5rem] font-bold text-white leading-none">{value}</p>
        {delta && (
          <span
            className={`text-sm font-medium ${delta.positive ? 'text-emerald-400' : 'text-red-400'}`}
          >
            {delta.text}
          </span>
        )}
      </div>
    </CardShell>
  );
}

export default function ActivityDashboardPage() {
  const { user, isLoading: userLoading } = useCurrentUser();
  const [range, setRange] = useState<Range>('7d');
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const flashTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const isAdmin = user?.role === 'admin';

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/activity/stats?range=${range}`);
      if (!res.ok) throw new Error(`stats failed: ${res.status}`);
      setStats(await res.json());
    } catch (e) {
      console.error(e);
      setError('Failed to load stats');
    }
  }, [range]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/activity?page=1&page_size=100');
      if (!res.ok) throw new Error(`logs failed: ${res.status}`);
      const data = await res.json();
      setLogs(data.logs);
    } catch (e) {
      console.error(e);
      setError('Failed to load activity log');
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      await Promise.all([loadStats(), loadLogs()]);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isAdmin, loadStats, loadLogs]);

  // Live feed via SSE
  useEffect(() => {
    if (!isAdmin) return;
    const es = new EventSource('/api/activity/events');
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.type === 'log' && parsed.row) {
          const row = parsed.row as LogRow;
          setLogs(prev => [row, ...prev].slice(0, 200));
          setNewIds(prev => {
            const next = new Set(prev);
            next.add(row.id);
            return next;
          });
          const existing = flashTimeouts.current.get(row.id);
          if (existing) clearTimeout(existing);
          const t = setTimeout(() => {
            setNewIds(prev => {
              const next = new Set(prev);
              next.delete(row.id);
              return next;
            });
            flashTimeouts.current.delete(row.id);
          }, 2000);
          flashTimeouts.current.set(row.id, t);
          void loadStats();
        }
      } catch { /* ignore malformed frames */ }
    };
    es.onerror = () => es.close();
    const timeoutsMap = flashTimeouts.current;
    return () => {
      es.close();
      timeoutsMap.forEach(clearTimeout);
      timeoutsMap.clear();
    };
  }, [isAdmin, loadStats]);

  const byPageData = useMemo(() => {
    if (!stats) return [];
    const grouped = new Map<string, Record<string, number>>();
    for (const r of stats.byDayByPage) {
      const day = r.day.split(' ')[0].slice(5);
      const bucket = bucketForPath(r.path);
      if (!grouped.has(day)) {
        grouped.set(day, Object.fromEntries(PAGE_BUCKETS.map(b => [b.key, 0])));
      }
      const row = grouped.get(day)!;
      row[bucket] = (row[bucket] ?? 0) + r.count;
    }
    return Array.from(grouped.entries())
      .map(([day, counts]) => ({ day, ...counts }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [stats]);

  const byEntityData = useMemo(() => {
    if (!stats) return [];
    return stats.byEntity.map(e => {
      const key = e.entityType ?? 'other';
      return {
        name: ENTITY_LABELS[key] ?? key,
        count: e.count,
        fill: ENTITY_COLORS[key] ?? '#64748b',
      };
    });
  }, [stats]);

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <CardShell className="p-10 max-w-md text-center">
          <Activity className="w-10 h-10 text-cyan-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Admin access only</h2>
          <p className="text-sm text-muted">This dashboard is restricted to administrators.</p>
        </CardShell>
      </div>
    );
  }

  return (
    <>
      <header className="flex-shrink-0 bg-transparent backdrop-blur-md border-b border-zinc-800/50 relative z-50 sticky top-0">
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Activity</h2>
              <p className="text-muted text-sm">Real-time usage, user activity, and signup telemetry</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-zinc-900/60 border border-zinc-800/50 rounded-lg p-0.5">
                {(['24h', '7d', '30d'] as Range[]).map(r => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      range === r
                        ? 'bg-gradient-to-l from-blue-600 to-cyan-500 text-white'
                        : 'text-muted hover:text-zinc-200'
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={() => { void loadStats(); void loadLogs(); }}
                className="p-2 bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-muted hover:text-cyan-400 hover:border-cyan-500/30 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="px-6 py-6 space-y-6">
        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard
          label="Total Users"
          sublabel={stats ? `${stats.users.active} active · ${stats.users.pending} pending` : ''}
          value={stats ? String(stats.users.total) : '—'}
          icon={Users}
        />
        <MetricCard
          label="Online Now"
          sublabel="active in last 5 min"
          value={stats ? String(stats.onlineNow) : '—'}
          icon={Wifi}
        />
      </div>

      {/* Chart row */}
      <div className="grid grid-cols-[40fr_60fr] gap-4">
        <CardShell className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white">App Useage by Category</h3>
            <p className="text-xs text-muted">A clear visual of user activity by category type</p>
          </div>
          <div className="h-64">
            <ClientOnlyChart>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byEntityData}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={75}
                    outerRadius={90}
                    paddingAngle={2}
                    stroke="#18181b"
                    strokeWidth={2}
                  >
                    {byEntityData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111113',
                      border: '1px solid #27272a',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#e4e4e7',
                    }}
                  />
                  <Legend
                    verticalAlign="middle"
                    align="right"
                    layout="vertical"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 12, color: '#a5a5b2' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </ClientOnlyChart>
          </div>
        </CardShell>

        <CardShell className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Activity by Page</h3>
              <p className="text-xs text-muted">Per-day activity count for each page</p>
            </div>
          </div>
          <div className="h-64">
            <ClientOnlyChart>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={byPageData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <defs>
                    {PAGE_BUCKETS.map(b => (
                      <linearGradient key={b.key} id={`areaFill-${b.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={b.color} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={b.color} stopOpacity={0.05} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="day" stroke="#a5a5b2" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#a5a5b2" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#111113',
                      border: '1px solid #27272a',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#e4e4e7',
                    }}
                    cursor={{ stroke: '#3f3f46' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#a5a5b2' }} />
                  {PAGE_BUCKETS.map(b => (
                    <Area
                      key={b.key}
                      type="monotone"
                      dataKey={b.key}
                      name={b.label}
                      stroke={b.color}
                      strokeWidth={2}
                      fill={`url(#areaFill-${b.key})`}
                      activeDot={{ r: 4 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ClientOnlyChart>
          </div>
        </CardShell>
      </div>

      {/* Live feed */}
      <div className="grid grid-cols-1 gap-4">
        <CardShell className="flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/50">
            <div>
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                Live Activity Feed
                <span className="inline-flex items-center gap-1 text-[0.65rem] font-normal text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live
                </span>
              </h3>
              <p className="text-xs text-muted">Newest actions stream in as they happen</p>
            </div>
            <span className="text-xs text-muted">{logs.length} shown</span>
          </div>
          <div className="overflow-x-auto max-h-[520px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-900/80 backdrop-blur-md z-10">
                <tr className="border-b border-zinc-800/50">
                  <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase tracking-wider text-muted font-medium w-24">Time</th>
                  <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase tracking-wider text-muted font-medium">User</th>
                  <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase tracking-wider text-muted font-medium">Office</th>
                  <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase tracking-wider text-muted font-medium">Details</th>
                  <th className="text-left px-4 py-2.5 text-[0.7rem] uppercase tracking-wider text-muted font-medium w-28">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted text-sm">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading…
                    </td>
                  </tr>
                )}
                {!loading && logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-muted text-sm">No activity yet.</td>
                  </tr>
                )}
                {logs.map(row => {
                  const isNew = newIds.has(row.id);
                  const badge = actionBadge(row.action);
                  const styles = BADGE_STYLES[badge.tone];
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors ${styles.rowGradient} ${
                        isNew ? 'bg-cyan-500/10' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <td className="px-4 py-2 text-xs text-muted font-mono whitespace-nowrap" title={row.timestamp}>
                        {formatAbsoluteTime(row.timestamp)}
                      </td>
                      <td className="px-4 py-2 text-zinc-200 whitespace-nowrap">
                        {row.userName ?? <span className="text-muted italic">anon</span>}
                        {row.userEmail && (
                          <span className="block text-[0.65rem] text-muted">{row.userEmail}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-300 whitespace-nowrap">
                        {row.userOffice ?? <span className="text-muted">—</span>}
                      </td>
                      <td className="px-4 py-2 text-xs text-zinc-200 max-w-[420px] truncate" title={JSON.stringify(row.details ?? {})}>
                        {detailsSummary(row)}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-[0.7rem] font-medium rounded-md border ${styles.badge}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardShell>
      </div>
      </div>
    </>
  );
}
