'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CodeXml, FileDown, FlaskConical, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/app/lib/auth/context';
import { toDisplayName } from '@/app/lib/auth/types';
import { getDevReport, getDevReportInputs, type DevReportData, type DevReportInputs } from '@/app/lib/api/dev-report';
import { generateDevReport } from '@/app/components/dashboard/kpis/report/generateDevReport';
import CodeMonthsEditor from '@/app/components/dashboard/dev-report/CodeMonthsEditor';
import ToolsEditor from '@/app/components/dashboard/dev-report/ToolsEditor';
import UsageImport from '@/app/components/dashboard/dev-report/UsageImport';
import { PRIMARY_BTN, SECONDARY_BTN } from '@/app/components/dashboard/dev-report/ui';

type PdfKind = 'review' | 'coding' | 'demo';

function SummaryTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 rounded-xl px-4 py-3">
      <p className="text-[0.7rem] font-mono uppercase tracking-[0.15em] text-muted">{label}</p>
      <p className="text-2xl font-light text-white mt-1 tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-zinc-400 mt-0.5">{sub}</p> : null}
    </div>
  );
}

/**
 * Founder-only: enter the software-development side of the job (code stats, tools,
 * tool usage) and download the year-to-date review PDF — the KPI report as page one,
 * the development report as page two. The API re-checks founder access on every call.
 */
export default function DevReportPage() {
  const { user, isLoading: userLoading } = useCurrentUser();
  const isFounder = Boolean(user?.isFounder);

  const [inputs, setInputs] = useState<DevReportInputs | null>(null);
  const [report, setReport] = useState<DevReportData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<PdfKind | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [i, r] = await Promise.all([getDevReportInputs(), getDevReport()]);
      setInputs(i);
      setReport(r);
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    if (isFounder) void reload();
  }, [isFounder, reload]);

  const download = async (kind: PdfKind) => {
    if (!user) return;
    setGenerating(kind);
    setPdfError(null);
    try {
      await generateDevReport({
        displayName: toDisplayName(user.firstName, user.lastName),
        includeKpi: kind !== 'coding',
        demo: kind === 'demo',
      });
    } catch (err) {
      console.error('Dev report generation failed:', err);
      setPdfError(err instanceof Error ? err.message : "Couldn't generate the PDF.");
    } finally {
      setGenerating(null);
    }
  };

  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  if (!isFounder) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 rounded-xl p-10 max-w-md text-center">
          <CodeXml className="w-10 h-10 text-cyan-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Founder access only</h2>
          <p className="text-sm text-muted">This page is private to the founding account.</p>
        </div>
      </div>
    );
  }

  const r = report;
  const spin = (kind: PdfKind) => (generating === kind ? <Loader2 className="w-4 h-4 animate-spin" /> : null);

  return (
    <>
      <header className="flex-shrink-0 bg-transparent backdrop-blur-md border-b border-zinc-800/50 relative z-50 sticky top-0">
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-semibold text-white">Development Report</h2>
              <p className="text-muted text-sm">
                Your software work this year. The review PDF puts your KPI report on page one and this on page two.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {pdfError && <span className="text-xs text-red-400">{pdfError}</span>}
              {/* TEMPORARY: preview the PDF with dummy data (see devReportDemo.ts). */}
              <button
                onClick={() => download('demo')}
                disabled={generating !== null}
                className={SECONDARY_BTN}
                title="Preview the review PDF with dummy development data. Nothing is saved."
              >
                {spin('demo') ?? <FlaskConical className="w-4 h-4" />}
                Demo
              </button>
              <button onClick={() => download('coding')} disabled={generating !== null} className={SECONDARY_BTN}>
                {spin('coding') ?? <FileDown className="w-4 h-4" />}
                Coding page only
              </button>
              <button onClick={() => download('review')} disabled={generating !== null} className={PRIMARY_BTN}>
                {spin('review') ?? <FileDown className="w-4 h-4" />}
                Generate review PDF
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="px-6 py-5 space-y-5 max-w-[1400px]">
        {loadError && <p className="text-sm text-red-400">{loadError}</p>}

        {r && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <SummaryTile
              label="Lines added"
              value={r.code.added.toLocaleString()}
              sub={`${r.code.deleted.toLocaleString()} deleted · net ${r.code.net >= 0 ? '+' : ''}${r.code.net.toLocaleString()}`}
            />
            <SummaryTile label="Commits" value={r.code.commits.toLocaleString()} sub={`${r.code.monthsEntered} months entered`} />
            <SummaryTile label="Live tools" value={String(r.tools.live)} sub={r.tools.beta ? `${r.tools.beta} in beta` : undefined} />
            <SummaryTile
              label="Tool uses"
              value={r.usage.total.toLocaleString()}
              sub={r.usage.firstDay ? `${Math.round(r.usage.avgPerDay).toLocaleString()} a day` : 'No usage imported'}
            />
            <SummaryTile
              label="Hours saved"
              value={Math.round(r.impact.hoursSaved).toLocaleString()}
              sub={
                r.impact.toolsMissingEstimate.length
                  ? `${r.impact.toolsMissingEstimate.length} tool${r.impact.toolsMissingEstimate.length === 1 ? '' : 's'} missing an estimate`
                  : r.impact.hoursSaved > 0
                    ? `About ${r.impact.workWeeks.toFixed(1)} work weeks`
                    : undefined
              }
            />
            <SummaryTile
              label="People reached"
              value={r.tools.largestAudience ? r.tools.largestAudience.users.toLocaleString() : '—'}
              sub={r.tools.largestAudience ? r.tools.largestAudience.name : undefined}
            />
          </div>
        )}

        {inputs ? (
          <>
            <UsageImport coverage={inputs.usage} knownTools={inputs.tools.map(t => t.name)} onChanged={reload} />
            <ToolsEditor tools={inputs.tools} onChanged={reload} />
            <CodeMonthsEditor year={inputs.year} months={inputs.months} onSaved={reload} />
          </>
        ) : (
          !loadError && (
            <div className="flex items-center text-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          )
        )}
      </div>
    </>
  );
}
