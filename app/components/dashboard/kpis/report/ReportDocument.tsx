/**
 * The Team KPIs "Generate PDF" report: a one-page, landscape year-in-review that a
 * person can hand their supervisor (or a lead can share for their team).
 *
 * Layout, top to bottom: header and one-sentence summary, six headline numbers with
 * change vs. the previous period, activity over time beside where the work went,
 * then top wins, top clients and speed. Styling follows the on-screen briefing,
 * recolored for paper (see pdfTokens.ts).
 */
import React from 'react';
import { Document, Page, View, Text } from '@react-pdf/renderer';
import type { KpiReportData, KpiReportBreakdownRow } from '@/app/lib/api/kpi';
import { formatCurrency, formatNumber } from '../utils';
import { PERIOD_LONG, HEAD_PERIOD } from '../briefing/briefing-utils';
import { toDisplayDate } from '@/app/lib/db/dateUtils';
import { P, MONO_FONT } from './pdfTokens';
import { ColumnPairChart, HBarList, DeltaChip, Swatch } from './pdfCharts';
import { PAGE_STYLE, Eyebrow, Rule, StatTile, Empty, ReportHeader, SummaryLine, ReportFooter } from './reportParts';

const MAX_BREAKDOWN_ROWS = 6;

export function reportTitle(period: string): string {
  if (period === '1Y') return 'Year in review';
  if (period === 'YTD') return 'Year to date in review';
  if (period === 'ALL') return 'All-time review';
  const long = PERIOD_LONG[period] ?? period;
  return `${long.charAt(0).toUpperCase()}${long.slice(1)} in review`;
}

/**
 * Top rows plus an "Other" rollup, so a long tail never overflows the page. A category
 * that is itself called "Other" folds into the rollup rather than appearing twice.
 */
function topWithOther(rows: KpiReportBreakdownRow[]): { name: string; value: number; color: string }[] {
  const named = rows.filter(r => r.name !== 'Other');
  const top = named.slice(0, MAX_BREAKDOWN_ROWS).map(r => ({ name: r.name || 'Unspecified', value: r.count, color: r.color }));
  const rest =
    named.slice(MAX_BREAKDOWN_ROWS).reduce((s, r) => s + r.count, 0) +
    rows.filter(r => r.name === 'Other').reduce((s, r) => s + r.count, 0);
  return rest > 0 ? [...top, { name: 'Other', value: rest, color: P.faint }] : top;
}

/** "The Default Team" rather than "The Default Team team". */
function teamPhrase(name: string): string {
  return /\bteam$/i.test(name) ? `The ${name}` : `The ${name} team`;
}

function summarySentence(d: KpiReportData): string {
  const t = d.totals;
  if (t.interactions.value === 0) return `No interactions were started ${HEAD_PERIOD[d.period] ?? ''}.`;
  const who = d.subject.kind === 'all' ? 'All teams' : d.subject.kind === 'team' ? teamPhrase(d.subject.name) : d.subject.name;
  const dInt = Math.round(t.interactions.deltaPercent);
  const trend = d.hasComparison && dInt !== 0 ? ` (${dInt > 0 ? 'up' : 'down'} ${Math.abs(dInt)}% ${d.comparisonLabel})` : '';
  const clients = `${formatNumber(t.clientsServed.value)} client${t.clientsServed.value === 1 ? '' : 's'}`;
  // ALL counts every client as new, which says nothing, so it's left out there.
  const newClients =
    d.period === 'ALL' || t.newClients === 0
      ? ''
      : t.newClients === t.clientsServed.value
        ? t.newClients === 1 ? ', a new one' : ', all of them new'
        : `, ${formatNumber(t.newClients)} of them new`;
  const interactions = `${formatNumber(t.interactions.value)} interaction${t.interactions.value === 1 ? '' : 's'}`;
  return (
    `${who} took on ${interactions} ${HEAD_PERIOD[d.period] ?? ''}${trend}, ` +
    `completed ${formatNumber(t.completed.value)}, and brought in ${formatCurrency(t.nna.value)} in net new assets ` +
    `across ${clients}${newClients}.`
  );
}

/** The KPI report as one page, so it can also lead a multi-page document. */
export function KpiReportPage({ data }: { data: KpiReportData }) {
  const t = data.totals;
  const cmp = data.hasComparison;
  const delta = (s: { deltaPercent: number }) => (cmp ? <DeltaChip delta={s.deltaPercent} label={data.comparisonLabel} /> : undefined);

  const subjectLine =
    data.subject.kind === 'person'
      ? [data.subject.title, data.subject.team].filter(Boolean).join(' · ')
      : data.subject.kind === 'team'
        ? 'Team report'
        : 'Cross-team report';
  const range = `${toDisplayDate(data.range.start)} – ${toDisplayDate(data.range.end)}`;
  const generated = toDisplayDate(data.generatedAt.slice(0, 10));
  const hasWork = t.interactions.value > 0;
  const bucketWord = data.series.granularity;

  return (
    <Page size="A4" orientation="landscape" style={PAGE_STYLE}>
      <ReportHeader
        eyebrow={`CRM Dashboard · ${reportTitle(data.period)}`}
        name={data.subject.name}
        subjectLine={subjectLine}
        range={range}
        note={cmp ? `Changes shown ${data.comparisonLabel === 'YoY' ? 'year over year' : data.comparisonLabel}` : undefined}
        generated={generated}
      />

      <SummaryLine>{summarySentence(data)}</SummaryLine>

      <Rule />

      {/* Headline numbers */}
      <View style={{ flexDirection: 'row' }}>
        <StatTile
          label="Interactions"
          value={formatNumber(t.interactions.value)}
          delta={delta(t.interactions)}
          sub={t.inProgress > 0 ? `${formatNumber(t.inProgress)} still in progress` : undefined}
        />
        <StatTile label="Completed" value={formatNumber(t.completed.value)} delta={delta(t.completed)} />
        <StatTile label="Net new assets" value={formatCurrency(t.nna.value)} delta={delta(t.nna)} />
        <StatTile
          label="Avg NNA / interaction"
          value={formatCurrency(Math.round(t.avgNna.value))}
          delta={delta(t.avgNna)}
        />
        <StatTile
          label="Completion rate"
          value={`${t.completionRate.value.toFixed(0)}%`}
          delta={
            cmp ? (
              <DeltaChip delta={t.completionRate.value - t.completionRate.prev} label={data.comparisonLabel} unit="pts" />
            ) : undefined
          }
        />
        <StatTile
          label="Clients served"
          value={formatNumber(t.clientsServed.value)}
          delta={delta(t.clientsServed)}
          sub={data.period !== 'ALL' && t.newClients > 0 ? `${formatNumber(t.newClients)} new this period` : undefined}
        />
      </View>

      <Rule />

      {/* Activity over time + where the work went */}
      <View style={{ flexDirection: 'row', gap: 28 }}>
        <View style={{ flex: 1.25 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Eyebrow>{`Activity by ${bucketWord}`}</Eyebrow>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Swatch color={P.cyanFill} />
                <Text style={{ fontSize: 6.5, color: P.muted }}>Started</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Swatch color={P.greenFill} />
                <Text style={{ fontSize: 6.5, color: P.muted }}>Completed</Text>
              </View>
            </View>
          </View>
          {data.series.points.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <ColumnPairChart points={data.series.points} height={118} />
            </View>
          ) : (
            <Empty>No activity in this period.</Empty>
          )}
        </View>

        <View style={{ flex: 1, flexDirection: 'row', gap: 18 }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>By client department</Eyebrow>
            {hasWork ? <HBarList rows={topWithOther(data.byDept)} format={formatNumber} /> : <Empty>—</Empty>}
          </View>
          <View style={{ flex: 1 }}>
            <Eyebrow>By project type</Eyebrow>
            {hasWork ? <HBarList rows={topWithOther(data.byType)} format={formatNumber} /> : <Empty>—</Empty>}
          </View>
        </View>
      </View>

      <Rule />

      {/* Top wins, top clients, speed */}
      <View style={{ flexDirection: 'row', gap: 28 }}>
        <View style={{ flex: 1.35 }}>
          <Eyebrow>Largest wins</Eyebrow>
          {data.topWins.length === 0 ? (
            <Empty>No completed work with net new assets in this period.</Empty>
          ) : (
            data.topWins.map((w, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 3.5,
                  borderBottom: i < data.topWins.length - 1 ? `0.5pt solid ${P.hairline}` : undefined,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 8, color: P.ink, maxLines: 1, textOverflow: 'ellipsis' }}>
                    {w.externalClient ? `${w.externalClient} · ${w.clientName}` : w.clientName}
                  </Text>
                  <Text style={{ fontSize: 6.5, color: P.muted, marginTop: 1, maxLines: 1, textOverflow: 'ellipsis' }}>
                    {`${w.type} · ${w.clientDept}${w.dateFinished ? ` · ${toDisplayDate(w.dateFinished)}` : ''}`}
                  </Text>
                </View>
                <Text style={{ fontFamily: MONO_FONT, fontSize: 8.5, color: P.green, marginLeft: 8 }}>
                  {formatCurrency(w.nna)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Eyebrow>Top clients by net new assets</Eyebrow>
          {data.topClients.length === 0 ? (
            <Empty>No net new assets in this period.</Empty>
          ) : (
            data.topClients.map((c, i) => (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 3.5,
                  borderBottom: i < data.topClients.length - 1 ? `0.5pt solid ${P.hairline}` : undefined,
                }}
              >
                <Text style={{ fontFamily: MONO_FONT, fontSize: 7, color: P.faint, width: 12 }}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 8, color: P.ink, maxLines: 1, textOverflow: 'ellipsis' }}>
                    {c.clientName}
                  </Text>
                  <Text style={{ fontSize: 6.5, color: P.muted, marginTop: 1, maxLines: 1, textOverflow: 'ellipsis' }}>
                    {`${c.clientDept} · ${c.share.toFixed(0)}% of total`}
                  </Text>
                </View>
                <Text style={{ fontFamily: MONO_FONT, fontSize: 8.5, color: P.ink, marginLeft: 8 }}>
                  {formatCurrency(c.nna)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={{ flex: 0.8 }}>
          <Eyebrow>Speed</Eyebrow>
          {data.cycle.overallMedian === null ? (
            <Empty>Nothing finished in this period.</Empty>
          ) : (
            <View>
              <Text style={{ fontSize: 20, color: P.ink }}>
                {`${Math.round(data.cycle.overallMedian)} `}
                <Text style={{ fontSize: 9, color: P.muted }}>{Math.round(data.cycle.overallMedian) === 1 ? 'day' : 'days'}</Text>
              </Text>
              <Text style={{ fontSize: 6.5, color: P.muted, marginTop: 2, marginBottom: 8 }}>
                {`Median start to finish across ${formatNumber(data.cycle.finishedCount)} finished`}
              </Text>
              {data.cycle.byType.map(c => (
                <View key={c.type} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                  <Swatch color={c.color} />
                  <Text style={{ flex: 1, fontSize: 7, color: P.strong, maxLines: 1, textOverflow: 'ellipsis' }}>
                    {c.type}
                  </Text>
                  <Text style={{ fontFamily: MONO_FONT, fontSize: 7, color: P.ink }}>{`${Math.round(c.median)}d`}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      <ReportFooter
        source={`Source: CRM engagements · ${range} · interactions counted by start date, completions by finish date`}
      />
    </Page>
  );
}

export default function ReportDocument({ data }: { data: KpiReportData }) {
  return (
    <Document title={`${data.subject.name} · ${reportTitle(data.period)}`} author="CRM Dashboard" creator="CRM Dashboard">
      <KpiReportPage data={data} />
    </Document>
  );
}
