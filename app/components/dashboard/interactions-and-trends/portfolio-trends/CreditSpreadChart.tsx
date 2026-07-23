'use client';

import React from 'react';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ClientOnlyChart from '@/app/components/dashboard/shared/ClientOnlyChart';
import type { CreditSpreadPoint } from '@/app/lib/types/portfolioTrends';
import { CHART_INK, SERIES_PALETTE } from './chartTokens';

/**
 * Option-adjusted spread history — the compensation for credit risk over government.
 *
 * Both series are basis points, so they share one axis. (Investment grade sits around
 * 100bp and high yield around 400bp, which is exactly the situation that tempts a second
 * y-scale; the wide gap is the information, and flattening it onto two scales would
 * destroy it.)
 *
 * Series are direct-labelled at the right edge rather than legended, since there are only
 * two and the endpoint is where the eye already is.
 */

interface Props {
  points: CreditSpreadPoint[];
}

const IG_COLOR = SERIES_PALETTE[0].hex;
const HY_COLOR = SERIES_PALETTE[1].hex;

function shortDate(iso: string): string {
  const [y, m] = iso.split('-');
  const month = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m)] ?? '';
  return `${month} ${y?.slice(2)}`;
}

/** Module scope, not defined inside the chart's render — see CharacteristicScatter. */
function SpreadTooltip({
  active, payload, label,
}: { active?: boolean; payload?: Array<{ dataKey?: string | number; value?: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const ig = payload.find((p) => p.dataKey === 'ig')?.value;
  const hy = payload.find((p) => p.dataKey === 'hy')?.value;
  return (
    <div className="border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs shadow-lg">
      <div className="mb-1 text-zinc-300">{label}</div>
      {ig != null && (
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2" style={{ background: IG_COLOR }} />
          <span className="text-zinc-400">Investment grade</span>
          <span className="font-mono tabular-nums text-zinc-100">{Math.round(ig)}bp</span>
        </div>
      )}
      {hy != null && (
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2" style={{ background: HY_COLOR }} />
          <span className="text-zinc-400">High yield</span>
          <span className="font-mono tabular-nums text-zinc-100">{Math.round(hy)}bp</span>
        </div>
      )}
    </div>
  );
}

export default function CreditSpreadChart({ points }: Props) {
  if (points.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-zinc-500">
        No credit spread history uploaded.
      </div>
    );
  }

  const last = points[points.length - 1];

  return (
    <div className="flex flex-1 flex-col">
      <ClientOnlyChart>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points.map((p) => ({ ...p, short: shortDate(p.asOf) }))}
            margin={{ top: 10, right: 12, bottom: 14, left: 0 }}
          >
            <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
            <XAxis
              dataKey="short"
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              minTickGap={24}
            />
            <YAxis
              tick={{ fill: CHART_INK.tick, fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: CHART_INK.axis }}
              width={46}
              tickFormatter={(v: number) => `${Math.round(v)}bp`}
            />
            <Tooltip content={<SpreadTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.15)' }} />
            <Line type="monotone" dataKey="ig" stroke={IG_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line type="monotone" dataKey="hy" stroke={HY_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </ClientOnlyChart>

      <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[10px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2" style={{ background: IG_COLOR }} />
          <span className="text-zinc-400">Investment grade</span>
          {last.ig != null && <span className="font-mono tabular-nums text-zinc-300">{Math.round(last.ig)}bp</span>}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2" style={{ background: HY_COLOR }} />
          <span className="text-zinc-400">High yield</span>
          {last.hy != null && <span className="font-mono tabular-nums text-zinc-300">{Math.round(last.hy)}bp</span>}
        </span>
      </div>
    </div>
  );
}
