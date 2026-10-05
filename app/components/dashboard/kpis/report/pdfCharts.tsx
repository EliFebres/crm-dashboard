/**
 * Chart primitives for the KPI report PDF. Recharts can't render inside react-pdf,
 * so these are small purpose-built charts drawn with plain Views (bars are just
 * boxes with a height or width), which lay out reliably in react-pdf's flexbox.
 */
import React from 'react';
import { View, Text } from '@react-pdf/renderer';
import { P, MONO_FONT } from './pdfTokens';

/** Opened vs. completed columns per time bucket. `colors` defaults to the KPI page's cyan/green. */
export function ColumnPairChart({
  points,
  height,
  colors = [P.cyanFill, P.greenFill],
  format = String,
}: {
  points: { label: string; opened: number; completed: number }[];
  height: number;
  colors?: [string, string];
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...points.flatMap(p => [p.opened, p.completed]));
  // Label at most ~12 buckets so the axis never turns into a smear.
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const plotH = height - 14;

  return (
    <View style={{ height }}>
      <View style={{ height: plotH, flexDirection: 'row', alignItems: 'flex-end', borderBottom: `0.75pt solid ${P.axis}` }}>
        {/* Top gridline with the scale's max value. */}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, borderTop: `0.5pt dashed ${P.hairline}` }} />
        <Text style={{ position: 'absolute', top: -9, left: 0, fontFamily: MONO_FONT, fontSize: 6, color: P.faint }}>
          {format(max)}
        </Text>
        {points.map((p, i) => (
          <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 1 }}>
            <View style={{ width: '38%', height: (p.opened / max) * plotH, backgroundColor: colors[0] }} />
            <View style={{ width: '38%', height: (p.completed / max) * plotH, backgroundColor: colors[1] }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', height: 14 }}>
        {points.map((p, i) => (
          <Text
            key={i}
            style={{ flex: 1, fontSize: 6, color: P.muted, textAlign: 'center', paddingTop: 4 }}
          >
            {i % labelEvery === 0 ? p.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Single-series columns per time bucket, in the same style as ColumnPairChart. */
export function ColumnChart({
  points,
  height,
  color,
  format = String,
}: {
  points: { label: string; value: number }[];
  height: number;
  color: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...points.map(p => p.value));
  const labelEvery = Math.max(1, Math.ceil(points.length / 12));
  const plotH = height - 14;

  return (
    <View style={{ height }}>
      <View style={{ height: plotH, flexDirection: 'row', alignItems: 'flex-end', borderBottom: `0.75pt solid ${P.axis}` }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, borderTop: `0.5pt dashed ${P.hairline}` }} />
        <Text style={{ position: 'absolute', top: -9, left: 0, fontFamily: MONO_FONT, fontSize: 6, color: P.faint }}>
          {format(max)}
        </Text>
        {points.map((p, i) => (
          <View key={i} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' }}>
            <View style={{ width: '70%', height: (p.value / max) * plotH, backgroundColor: color }} />
          </View>
        ))}
      </View>
      {/* Labels are centered on their column but may be wider than it (e.g. "Mar 16" over
          30 narrow weekly columns), so they're positioned absolutely instead of clipped. */}
      <View style={{ height: 14 }}>
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <Text
              key={i}
              style={{
                position: 'absolute',
                left: `${((i + 0.5) / points.length) * 100}%`,
                width: 40,
                marginLeft: -20,
                fontSize: 6,
                color: P.muted,
                textAlign: 'center',
                paddingTop: 4,
              }}
            >
              {p.label}
            </Text>
          ) : null
        )}
      </View>
    </View>
  );
}

/** Horizontal bars: name on the left, proportional bar, value on the right. */
export function HBarList({
  rows,
  format,
}: {
  rows: { name: string; value: number; color: string; note?: string }[];
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <View style={{ gap: 5 }}>
      {rows.map(r => (
        <View key={r.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ width: 82, fontSize: 7.5, color: P.ink, maxLines: 1, textOverflow: 'ellipsis' }}>
            {r.name}
          </Text>
          <View style={{ flex: 1, height: 7, backgroundColor: P.track }}>
            <View style={{ width: `${(r.value / max) * 100}%`, height: 7, backgroundColor: r.color }} />
          </View>
          <Text style={{ width: 30, fontFamily: MONO_FONT, fontSize: 7, color: P.ink, textAlign: 'right' }}>
            {format(r.value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Colored "+12% YoY"-style change marker. `unit` switches to percentage points. */
export function DeltaChip({
  delta,
  label,
  unit = '%',
}: {
  delta: number;
  label: string;
  unit?: '%' | 'pts';
}) {
  const rounded = unit === 'pts' ? Math.round(delta * 10) / 10 : Math.round(delta);
  const color = rounded > 0 ? P.green : rounded < 0 ? P.red : P.muted;
  const text = rounded === 0 ? 'flat' : `${rounded > 0 ? '+' : ''}${rounded}${unit === 'pts' ? ' pts' : '%'}`;
  return (
    <Text style={{ fontFamily: MONO_FONT, fontSize: 7, color: P.muted }}>
      <Text style={{ color }}>{text}</Text> {label}
    </Text>
  );
}

/** Small colored square used in legends. */
export function Swatch({ color }: { color: string }) {
  return <View style={{ width: 6, height: 6, backgroundColor: color }} />;
}
