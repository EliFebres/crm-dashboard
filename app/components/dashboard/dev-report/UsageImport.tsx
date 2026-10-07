'use client';

import React, { useMemo, useState } from 'react';
import { ClipboardPaste, Loader2, Trash2 } from 'lucide-react';
import { importUsage, clearUsage, type DevReportInputs } from '@/app/lib/api/dev-report';
import { parseUsage } from '@/app/lib/dev-report/parseUsage';
import { toDisplayDate } from '@/app/lib/db/dateUtils';
import { PRIMARY_BTN, SECONDARY_BTN, Section, StatusLine } from './ui';

const MAX_ERRORS_SHOWN = 8;

/** Paste daily usage from Excel (Date, Tool, Count), preview it, then import. */
export default function UsageImport({
  coverage,
  knownTools,
  onChanged,
}: {
  coverage: DevReportInputs['usage'];
  knownTools: string[];
  onChanged: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'import' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const parsed = useMemo(() => (text.trim() ? parseUsage(text) : null), [text]);
  const preview = useMemo(() => {
    if (!parsed || parsed.rows.length === 0) return null;
    const known = new Set(knownTools.map(t => t.toLowerCase()));
    const tools = new Map<string, string>();
    for (const r of parsed.rows) if (!tools.has(r.tool.toLowerCase())) tools.set(r.tool.toLowerCase(), r.tool);
    return {
      first: parsed.rows[0].day,
      last: parsed.rows.reduce((m, r) => (r.day > m ? r.day : m), parsed.rows[0].day),
      total: parsed.rows.reduce((s, r) => s + r.count, 0),
      tools: [...tools.values()],
      newTools: [...tools.entries()].filter(([k]) => !known.has(k)).map(([, v]) => v),
    };
  }, [parsed, knownTools]);

  const doImport = async () => {
    if (!parsed || parsed.rows.length === 0) return;
    setBusy('import');
    setError(null);
    setOk(null);
    try {
      const res = await importUsage(parsed.rows);
      setText('');
      setOk(
        `Imported ${res.imported.toLocaleString()} rows.` +
          (res.createdTools.length ? ` Added to the inventory: ${res.createdTools.join(', ')}.` : '')
      );
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doClear = async () => {
    if (!window.confirm(`Delete all ${coverage.rows.toLocaleString()} usage rows? Your tools are kept. This can't be undone.`)) return;
    setBusy('clear');
    setError(null);
    setOk(null);
    try {
      await clearUsage();
      setOk('Usage cleared.');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section
      icon={ClipboardPaste}
      title="Daily tool usage"
      description="Copy the table from Excel and paste it below: one row per tool per day, with columns Date, Tool, Count. Re-pasting days you've already imported just updates them."
      actions={
        coverage.rows > 0 ? (
          <button onClick={doClear} disabled={busy !== null} className={SECONDARY_BTN}>
            {busy === 'clear' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Clear usage
          </button>
        ) : undefined
      }
    >
      <p className="text-xs text-zinc-400 mb-2">
        {coverage.rows > 0
          ? `On file: ${coverage.rows.toLocaleString()} rows · ${coverage.totalUses.toLocaleString()} uses · ${toDisplayDate(coverage.firstDay)} – ${toDisplayDate(coverage.lastDay)} · ${coverage.toolCount} tools`
          : 'Nothing imported yet.'}
      </p>

      <textarea
        value={text}
        onChange={e => {
          setText(e.target.value);
          setOk(null);
        }}
        rows={7}
        spellCheck={false}
        placeholder={'Date\tTool\tCount\n3/15/2026\tProposal Builder\t18\n3/15/2026\tModel Comparison\t12'}
        className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white text-xs font-mono placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
      />

      {parsed && (
        <div className="mt-3 text-xs space-y-1.5">
          {preview ? (
            <p className="text-zinc-300">
              <span className="text-white font-medium">{parsed.rows.length.toLocaleString()} rows</span> ·{' '}
              {preview.total.toLocaleString()} uses · {toDisplayDate(preview.first)} – {toDisplayDate(preview.last)} ·{' '}
              {preview.tools.length} tools
              {preview.newTools.length > 0 && (
                <span className="text-cyan-400"> · new: {preview.newTools.join(', ')}</span>
              )}
            </p>
          ) : (
            <p className="text-zinc-400">No valid rows found.</p>
          )}
          {parsed.errors.length > 0 && (
            <div className="text-amber-400">
              <p>
                {parsed.errors.length} line{parsed.errors.length === 1 ? '' : 's'} will be skipped:
              </p>
              <ul className="list-disc ml-5 mt-0.5">
                {parsed.errors.slice(0, MAX_ERRORS_SHOWN).map(e => (
                  <li key={e.line}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
                {parsed.errors.length > MAX_ERRORS_SHOWN && <li>…and {parsed.errors.length - MAX_ERRORS_SHOWN} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <button onClick={doImport} disabled={!preview || busy !== null} className={PRIMARY_BTN}>
          {busy === 'import' && <Loader2 className="w-4 h-4 animate-spin" />}
          Import{preview ? ` ${parsed!.rows.length.toLocaleString()} rows` : ''}
        </button>
      </div>
      <StatusLine error={error} ok={ok} />
    </Section>
  );
}
