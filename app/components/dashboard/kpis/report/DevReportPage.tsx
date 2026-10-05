/**
 * Page two of the founder's year-to-date review: the software-development side of the
 * job. Same title section, type scale and footer as the KPI page (reportParts.tsx);
 * the data comes from the founder's own entries (code stats, tool inventory, usage).
 *
 * Layout, top to bottom: header and one-sentence summary, six headline numbers, tool
 * usage over time beside uses by tool, then code by month, hours saved and the inventory.
 */
import React from 'react';
import { Page, View, Text } from '@react-pdf/renderer';
import type { DevReportData } from '@/app/lib/api/dev-report';
import type { KpiReportData } from '@/app/lib/api/kpi';
import { formatNumber } from '../utils';
import { toDisplayDate } from '@/app/lib/db/dateUtils';
import { P, MONO_FONT, RED_FILL, YELLOW_LINE } from './pdfTokens';
import { ColumnChart, ColumnPairChart, HBarList, Swatch } from './pdfCharts';
import { PAGE_STYLE, Eyebrow, Rule, StatTile, Empty, ReportHeader, SummaryLine, ReportFooter } from './reportParts';

const MAX_BAR_ROWS = 6;
/** Average month length (365.25 / 12), for turning a daily rate into a monthly one. */
const DAYS_PER_MONTH = 30.44;
const MAX_INVENTORY_ROWS = 6;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS_LABEL = { live: 'Live', beta: 'Beta', retired: 'Retired' } as const;

/** "Mar 15" */
function shortDate(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

/** 12,400 → "12.4K"; keeps narrow value columns readable. */
function compact(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return formatNumber(Math.round(v));
}

function plural(n: number, word: string): string {
  return `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** Top rows plus an "Other" rollup, so a long tail never overflows the page. */
function topWithOther(rows: { name: string; value: number; color: string }[]) {
  const top = rows.slice(0, MAX_BAR_ROWS);
  const rest = rows.slice(MAX_BAR_ROWS).reduce((s, r) => s + r.value, 0);
  return rest > 0 ? [...top, { name: 'Other', value: rest, color: P.faint }] : top;
}

function summarySentence(d: DevReportData, name: string): string {
  const parts: string[] = [];
  if (d.code.added > 0 || d.code.commits > 0) {
    parts.push(`wrote ${plural(d.code.added, 'line')} of code across ${plural(d.code.commits, 'commit')} this year`);
  }
  if (d.tools.live > 0) {
    const beta = d.tools.beta > 0 ? ` (plus ${formatNumber(d.tools.beta)} in beta)` : '';
    let tools = `runs ${plural(d.tools.live, 'live tool')}${beta}`;
    if (d.usage.total > 0 && d.usage.firstDay) {
      tools += `, used ${plural(d.usage.total, 'time')} since ${shortDate(d.usage.firstDay)}`;
      if (d.impact.hoursSaved >= 1) tools += ` and saving an estimated ${plural(Math.round(d.impact.hoursSaved), 'hour')}`;
    }
    parts.push(tools);
  }
  if (parts.length === 0) return 'No development work has been recorded yet this year.';
  return `${name} ${parts.join(' and ')}.`;
}

export default function DevReportPage({
  data,
  subject,
  demo = false,
}: {
  data: DevReportData;
  subject: KpiReportData['subject'];
  /** TEMPORARY: marks a page built from dummy data (the Dev Report page's Demo button). */
  demo?: boolean;
}) {
  const range = `${toDisplayDate(data.range.start)} – ${toDisplayDate(data.range.end)}`;
  const generated = toDisplayDate(data.generatedAt.slice(0, 10));
  const subjectLine = [subject.title, subject.team].filter(Boolean).join(' · ');
  const { code, usage, impact, tools } = data;
  const monthsElapsed = Math.max(1, code.months.length);
  // Average usage over the tracked period. The line sits on the weekly bars' scale;
  // the legend states the same rate per month.
  const avgPerWeek = usage.avgPerDay * 7;
  const avgPerMonth = usage.avgPerDay * DAYS_PER_MONTH;

  const inventory = [...tools.list].sort((a, b) => b.uses - a.uses).slice(0, MAX_INVENTORY_ROWS);
  const moreTools = tools.list.length - inventory.length;

  return (
    <Page size="A4" orientation="landscape" style={PAGE_STYLE}>
      <ReportHeader
        eyebrow="CRM Dashboard · Software development · Year to date in review"
        name={subject.name}
        subjectLine={subjectLine}
        range={range}
        note={
          demo
            ? 'DEMO DATA · not real figures'
            : usage.firstDay
              ? `Tool usage tracked since ${toDisplayDate(usage.firstDay)}`
              : undefined
        }
        generated={generated}
      />

      <SummaryLine>{summarySentence(data, subject.name)}</SummaryLine>

      <Rule />

      {/* Headline numbers */}
      <View style={{ flexDirection: 'row' }}>
        <StatTile
          label="Lines of code added"
          value={formatNumber(code.added)}
          sub={`${formatNumber(code.deleted)} deleted · net ${code.net >= 0 ? '+' : ''}${formatNumber(code.net)}`}
        />
        <StatTile
          label="Commits"
          value={formatNumber(code.commits)}
          sub={`${formatNumber(Math.round(code.commits / monthsElapsed))} a month on average`}
        />
        <StatTile
          label="Live tools"
          value={formatNumber(tools.live)}
          sub={tools.beta > 0 ? `${formatNumber(tools.beta)} more in beta` : undefined}
        />
        <StatTile
          label="Tool uses"
          value={formatNumber(usage.total)}
          sub={usage.firstDay ? `Since ${shortDate(usage.firstDay)} · ${formatNumber(Math.round(usage.avgPerDay))} a day` : undefined}
        />
        <StatTile
          label="Hours saved"
          value={formatNumber(Math.round(impact.hoursSaved))}
          sub={impact.hoursSaved > 0 ? `About ${impact.workWeeks.toFixed(1)} work weeks` : undefined}
        />
        <StatTile
          label="People reached"
          value={tools.largestAudience ? formatNumber(tools.largestAudience.users) : '—'}
          sub={tools.largestAudience ? `Largest audience: ${tools.largestAudience.name}` : undefined}
        />
      </View>

      <Rule />

      {/* Usage over time + uses by tool */}
      <View style={{ flexDirection: 'row', gap: 28 }}>
        <View style={{ flex: 1.25 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Eyebrow>Tool uses by week</Eyebrow>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {usage.total > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <View style={{ width: 10, borderTop: `1.25pt dashed ${YELLOW_LINE}` }} />
                  <Text style={{ fontSize: 6.5, color: P.muted }}>{`Avg ${formatNumber(Math.round(avgPerMonth))} uses / month`}</Text>
                </View>
              ) : null}
              {usage.growth ? (
                <Text style={{ fontFamily: MONO_FONT, fontSize: 7, color: P.muted }}>
                  <Text style={{ color: usage.growth.pct >= 0 ? P.green : P.red }}>
                    {`${usage.growth.pct >= 0 ? '+' : ''}${Math.round(usage.growth.pct)}%`}
                  </Text>
                  {` ${usage.growth.toLabel} vs ${usage.growth.fromLabel}`}
                </Text>
              ) : null}
            </View>
          </View>
          {usage.weekly.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <ColumnChart
                points={usage.weekly}
                height={118}
                color={P.cyanFill}
                format={compact}
                overlay={
                  usage.total > 0
                    ? { segments: [{ from: 0, to: usage.weekly.length - 1, value: avgPerWeek }], color: YELLOW_LINE }
                    : undefined
                }
              />
              <Text style={{ fontSize: 6.5, color: P.muted, marginTop: 4 }}>
                {`Weeks start Monday · the latest week is still in progress · dashed line: average week (${formatNumber(Math.round(avgPerWeek))} uses)`}
              </Text>
            </View>
          ) : (
            <Empty>No tool usage recorded this year.</Empty>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Eyebrow>Uses by tool</Eyebrow>
          {usage.byTool.length > 0 ? (
            <HBarList rows={topWithOther(usage.byTool.map(t => ({ name: t.name, value: t.uses, color: t.color })))} format={compact} />
          ) : (
            <Empty>—</Empty>
          )}
          {usage.busiestDay ? (
            <Text style={{ fontSize: 6.5, color: P.muted, marginTop: 8 }}>
              {`Busiest day: ${toDisplayDate(usage.busiestDay.day)}, ${plural(usage.busiestDay.count, 'use')}`}
            </Text>
          ) : null}
        </View>
      </View>

      <Rule />

      {/* Code by month, hours saved, inventory */}
      <View style={{ flexDirection: 'row', gap: 28 }}>
        <View style={{ flex: 1.1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Eyebrow>Code by month</Eyebrow>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Swatch color={P.greenFill} />
                <Text style={{ fontSize: 6.5, color: P.muted }}>Added</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Swatch color={RED_FILL} />
                <Text style={{ fontSize: 6.5, color: P.muted }}>Deleted</Text>
              </View>
            </View>
          </View>
          {code.monthsEntered > 0 ? (
            <View style={{ marginTop: 8 }}>
              <ColumnPairChart
                points={code.months.map(m => ({ label: m.label, opened: m.added, completed: m.deleted }))}
                height={100}
                colors={[P.greenFill, RED_FILL]}
                format={formatNumber}
              />
            </View>
          ) : (
            <Empty>No code stats entered yet.</Empty>
          )}
        </View>

        <View style={{ flex: 0.9 }}>
          <Eyebrow>Hours saved by tool</Eyebrow>
          {impact.byTool.length > 0 ? (
            <HBarList rows={topWithOther(impact.byTool.map(t => ({ name: t.name, value: t.hours, color: t.color })))} format={compact} />
          ) : (
            <Empty>Add minutes saved per use to see hours saved.</Empty>
          )}
          <Text style={{ fontSize: 6.5, color: P.muted, marginTop: 8 }}>
            {impact.toolsMissingEstimate.length > 0
              ? `Uses × estimated minutes saved per use. Not yet estimated: ${impact.toolsMissingEstimate.join(', ')}.`
              : 'Uses × estimated minutes saved per use.'}
          </Text>
        </View>

        <View style={{ flex: 1.1 }}>
          <Eyebrow>Tool inventory</Eyebrow>
          {inventory.length === 0 ? (
            <Empty>No tools added yet.</Empty>
          ) : (
            inventory.map((t, i) => (
              <View
                key={t.name}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingVertical: 2.5,
                  borderBottom: i < inventory.length - 1 ? `0.5pt solid ${P.hairline}` : undefined,
                }}
              >
                <Swatch color={t.color} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 8, color: P.ink, maxLines: 1, textOverflow: 'ellipsis' }}>{t.name}</Text>
                  <Text style={{ fontSize: 6.5, color: P.muted, marginTop: 1, maxLines: 1, textOverflow: 'ellipsis' }}>
                    {[
                      STATUS_LABEL[t.status],
                      t.launchedOn ? `launched ${toDisplayDate(t.launchedOn)}` : null,
                      t.usersReached ? plural(t.usersReached, 'user') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text style={{ fontFamily: MONO_FONT, fontSize: 8, color: P.ink, marginLeft: 6 }}>{compact(t.uses)}</Text>
              </View>
            ))
          )}
          {moreTools > 0 ? (
            <Text style={{ fontSize: 6.5, color: P.faint, marginTop: 4 }}>{`+ ${plural(moreTools, 'more tool')}`}</Text>
          ) : null}
        </View>
      </View>

      <ReportFooter
        source={`Source: self-reported code stats and tool usage logs · ${range} · hours saved = uses × estimated minutes saved per use`}
      />
    </Page>
  );
}
