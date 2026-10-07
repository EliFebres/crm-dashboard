/**
 * TEMPORARY: dummy development-report data for the Dev Report page's "Demo" button,
 * so the PDF can be previewed before any real data is entered. Generated in the
 * browser and never saved. To remove: delete this file and the Demo button/`demo`
 * option in generateDevReport.ts and app/dashboard/dev-report/page.tsx.
 */
import { DEV_TOOL_PALETTE, type DevReportData, type DevToolStatus } from '@/app/lib/api/dev-report';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

const TOOLS: { name: string; status: DevToolStatus; launched: string; minutes: number | null; users: number; base: number; growth: number }[] = [
  { name: 'Proposal Builder', status: 'live', launched: '03-15', minutes: 25, users: 34, base: 18, growth: 0.012 },
  { name: 'Model Comparison', status: 'live', launched: '03-15', minutes: 15, users: 28, base: 14, growth: 0.009 },
  { name: 'Holdings Uploader', status: 'live', launched: '04-02', minutes: 10, users: 22, base: 9, growth: 0.007 },
  { name: 'Ticker Lookup', status: 'live', launched: '05-11', minutes: 3, users: 41, base: 20, growth: 0.006 },
  { name: 'Fee Calculator', status: 'live', launched: '06-20', minutes: 8, users: 15, base: 6, growth: 0.01 },
  { name: 'Meeting Prep Packs', status: 'live', launched: '08-04', minutes: null, users: 6, base: 3, growth: 0.02 },
  { name: 'Rebalance Planner', status: 'live', launched: '03-15', minutes: 20, users: 19, base: 7, growth: 0.008 },
  { name: 'Account Opener', status: 'live', launched: '04-14', minutes: 12, users: 26, base: 8, growth: 0.006 },
  { name: 'Client Notes Sync', status: 'live', launched: '04-28', minutes: 5, users: 37, base: 12, growth: 0.005 },
  { name: 'RMD Calculator', status: 'live', launched: '05-19', minutes: 6, users: 18, base: 4, growth: 0.009 },
  { name: 'Risk Questionnaire', status: 'live', launched: '06-02', minutes: 15, users: 21, base: 5, growth: 0.011 },
  { name: 'Statement Parser', status: 'live', launched: '07-07', minutes: 18, users: 12, base: 4, growth: 0.015 },
  { name: 'Billing Reconciler', status: 'live', launched: '08-18', minutes: 30, users: 5, base: 2, growth: 0.018 },
  { name: 'Compliance Checklist', status: 'live', launched: '09-08', minutes: 7, users: 30, base: 6, growth: 0.02 },
];

const pad = (n: number) => String(n).padStart(2, '0');
const isoUTC = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Deterministic 0–1 noise so the demo looks the same every time. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function buildDemoDevReport(): DevReportData {
  const now = new Date();
  const year = now.getFullYear();
  const today = `${year}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const todayT = Date.UTC(year, now.getMonth(), now.getDate());
  const trackStart = `${year}-03-15`;

  // Code: Jan → current month.
  const months = Array.from({ length: now.getMonth() + 1 }, (_, i) => {
    const added = Math.round(3200 + i * 450 + noise(i + 1) * 2400);
    return { month: `${year}-${pad(i + 1)}`, label: MONTHS[i], commits: Math.round(38 + i * 4 + noise(i + 7) * 25), added, deleted: Math.round(added * (0.22 + noise(i + 3) * 0.2)) };
  });
  const sum = (k: 'commits' | 'added' | 'deleted') => months.reduce((s, m) => s + m[k], 0);

  // Usage: weekdays only, each tool from its launch date, growing over time.
  const perDay = new Map<string, number>();
  const perTool = new Map<string, number>();
  const startT = Date.UTC(year, 2, 15);
  for (let t = startT, i = 0; t <= todayT; t += DAY_MS, i++) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const day = isoUTC(t);
    TOOLS.forEach((tool, ti) => {
      if (day < `${year}-${tool.launched}`) return;
      const n = Math.round(tool.base * (1 + tool.growth * i) * (0.7 + noise(i * 10 + ti) * 0.6));
      perDay.set(day, (perDay.get(day) ?? 0) + n);
      perTool.set(tool.name, (perTool.get(tool.name) ?? 0) + n);
    });
  }
  const days = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const total = days.reduce((s, [, n]) => s + n, 0);
  const firstDay = days[0]?.[0] ?? null;
  const lastDay = days.at(-1)?.[0] ?? null;
  const busiest = days.reduce<{ day: string; count: number } | null>((b, [day, n]) => (!b || n > b.count ? { day, count: n } : b), null);

  const weekOf = (iso: string) => {
    const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
    return isoUTC(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS);
  };
  const byWeek = new Map<string, number>();
  for (const [day, n] of days) byWeek.set(weekOf(day), (byWeek.get(weekOf(day)) ?? 0) + n);
  const weekly = [];
  for (let w = weekOf(trackStart); w <= weekOf(today); w = isoUTC(Date.parse(w) + 7 * DAY_MS)) {
    weekly.push({ weekStart: w, label: `${MONTHS[Number(w.slice(5, 7)) - 1]} ${Number(w.slice(8, 10))}`, value: byWeek.get(w) ?? 0 });
  }

  const monthTotal = (m: number) => days.filter(([d]) => Number(d.slice(5, 7)) === m).reduce((s, [, n]) => s + n, 0);
  const lastFull = now.getMonth(); // 1-based number of the previous month
  const growth =
    lastFull > 4 && monthTotal(4) > 0
      ? { fromLabel: 'Apr', toLabel: MONTHS[lastFull - 1], pct: ((monthTotal(lastFull) - monthTotal(4)) / monthTotal(4)) * 100 }
      : null;

  const color = (i: number) => DEV_TOOL_PALETTE[i % DEV_TOOL_PALETTE.length];
  const byTool = TOOLS.map((t, i) => ({ name: t.name, uses: perTool.get(t.name) ?? 0, color: color(i) }))
    .filter(t => t.uses > 0)
    .sort((a, b) => b.uses - a.uses);
  const impactByTool = TOOLS.map((t, i) => ({ name: t.name, hours: ((perTool.get(t.name) ?? 0) * (t.minutes ?? 0)) / 60, color: color(i) }))
    .filter(t => t.hours > 0)
    .sort((a, b) => b.hours - a.hours);
  const hoursSaved = impactByTool.reduce((s, t) => s + t.hours, 0);
  const audience = TOOLS.reduce((b, t) => (t.users > b.users ? { name: t.name, users: t.users } : b), { name: '', users: 0 });

  return {
    year,
    range: { start: `${year}-01-01`, end: today },
    generatedAt: new Date().toISOString(),
    code: { commits: sum('commits'), added: sum('added'), deleted: sum('deleted'), net: sum('added') - sum('deleted'), monthsEntered: months.length, months },
    usage: { total, firstDay, lastDay, avgPerDay: total / Math.max(1, Math.round((Date.parse(lastDay ?? today) - Date.parse(firstDay ?? today)) / DAY_MS) + 1), busiestDay: busiest, weekly, byTool, growth },
    impact: {
      hoursSaved,
      hoursPerWorkday: hoursSaved / Math.max(1, days.length), // demo usage is weekdays only
      byTool: impactByTool,
      toolsMissingEstimate: TOOLS.filter(t => !t.minutes && (perTool.get(t.name) ?? 0) > 0).map(t => t.name),
    },
    tools: {
      live: TOOLS.filter(t => t.status === 'live').length,
      beta: TOOLS.filter(t => t.status === 'beta').length,
      retired: 0,
      largestAudience: audience.users > 0 ? audience : null,
      list: TOOLS.map((t, i) => ({
        name: t.name,
        status: t.status,
        launchedOn: `${year}-${t.launched}`,
        usersReached: t.users,
        uses: perTool.get(t.name) ?? 0,
        color: color(i),
      })),
    },
  };
}
