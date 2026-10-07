/**
 * Building blocks shared by the report PDF pages (the KPI page and the founder's
 * development page), so every page carries the same title section, type scale and footer.
 */
import React from 'react';
import { View, Text } from '@react-pdf/renderer';
import { P, SANS_FONT, SANS_BOLD, MONO_FONT, MONO_BOLD } from './pdfTokens';

/** A4 landscape page style used by every report page. */
export const PAGE_STYLE = { backgroundColor: P.page, color: P.ink, fontFamily: SANS_FONT, padding: 36, paddingBottom: 44 };

export function Eyebrow({ children, color = P.eyebrow }: { children: React.ReactNode; color?: string }) {
  return (
    <Text style={{ fontFamily: MONO_FONT, fontSize: 7, letterSpacing: 1.2, textTransform: 'uppercase', color, marginBottom: 6 }}>
      {children}
    </Text>
  );
}

export function Rule() {
  return <View style={{ borderTop: `0.75pt solid ${P.hairline}`, marginVertical: 10 }} />;
}

export function StatTile({
  label,
  value,
  sub,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1, paddingRight: 10 }}>
      <Eyebrow>{label}</Eyebrow>
      <Text style={{ fontSize: 20, color: P.ink, marginBottom: 4 }}>{value}</Text>
      {delta}
      {sub ? <Text style={{ fontSize: 7, color: P.muted, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 8, color: P.faint, paddingVertical: 8 }}>{children}</Text>;
}

/** The title section: eyebrow, name and subject line on the left; range and notes on the right. */
export function ReportHeader({
  eyebrow,
  name,
  subjectLine,
  range,
  note,
  generated,
}: {
  eyebrow: string;
  name: string;
  subjectLine?: string;
  range: string;
  /** Optional middle line on the right, e.g. "Changes shown year over year". */
  note?: string;
  generated: string;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: MONO_BOLD, fontSize: 7, letterSpacing: 1.2, textTransform: 'uppercase', color: P.cyanFill, marginBottom: 6 }}>
          {eyebrow}
        </Text>
        <Text style={{ fontSize: 24, color: P.ink, letterSpacing: -0.4 }}>{name}</Text>
        {subjectLine ? <Text style={{ fontSize: 9, color: P.muted, marginTop: 4 }}>{subjectLine}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: MONO_FONT, fontSize: 8, color: P.strong }}>{range}</Text>
        {note ? <Text style={{ fontFamily: MONO_FONT, fontSize: 7, color: P.muted, marginTop: 3 }}>{note}</Text> : null}
        <Text style={{ fontFamily: MONO_FONT, fontSize: 7, color: P.faint, marginTop: 3 }}>{`Generated ${generated}`}</Text>
      </View>
    </View>
  );
}

/** The one-sentence summary under the header. */
export function SummaryLine({ children }: { children: string }) {
  return <Text style={{ fontSize: 11, color: P.strong, lineHeight: 1.4, marginTop: 10, maxWidth: 620 }}>{children}</Text>;
}

/** Fixed footer: a source line on the left, page numbers on the right. */
export function ReportFooter({ source }: { source: string }) {
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        left: 36,
        right: 36,
        bottom: 20,
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderTop: `0.5pt solid ${P.hairline}`,
        paddingTop: 6,
      }}
    >
      <Text style={{ fontFamily: MONO_FONT, fontSize: 6, color: P.faint }}>{source}</Text>
      <Text
        style={{ fontFamily: SANS_BOLD, fontSize: 6, color: P.faint }}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
}
