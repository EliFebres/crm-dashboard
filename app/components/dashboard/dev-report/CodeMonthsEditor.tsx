'use client';

import React, { useEffect, useState } from 'react';
import { GitCommitHorizontal, Loader2 } from 'lucide-react';
import { saveCodeMonths, type DevCodeMonth } from '@/app/lib/api/dev-report';
import { INPUT, PRIMARY_BTN, Section, StatusLine } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
type Field = 'commits' | 'linesAdded' | 'linesDeleted';
type Draft = Record<string, Record<Field, string>>;

/** Jan → current month of `year`, as YYYY-MM keys. */
function monthKeys(year: number): string[] {
  const now = new Date();
  const last = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  return Array.from({ length: last }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
}

function toDraft(year: number, months: DevCodeMonth[]): Draft {
  const byMonth = new Map(months.map(m => [m.month, m]));
  return Object.fromEntries(
    monthKeys(year).map(k => {
      const m = byMonth.get(k);
      return [k, { commits: m ? String(m.commits) : '', linesAdded: m ? String(m.linesAdded) : '', linesDeleted: m ? String(m.linesDeleted) : '' }];
    })
  );
}

/** Monthly commits / lines added / lines deleted (as on GitHub's contributor graph). */
export default function CodeMonthsEditor({
  year,
  months,
  onSaved,
}: {
  year: number;
  months: DevCodeMonth[];
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(year, months));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => setDraft(toDraft(year, months)), [year, months]);

  const setCell = (month: string, field: Field, value: string) => {
    setOk(null);
    setDraft(d => ({ ...d, [month]: { ...d[month], [field]: value } }));
  };

  const num = (s: string) => Number(s.replace(/,/g, '').trim() || 0);
  const totals = (field: Field) => Object.values(draft).reduce((s, r) => s + (Number.isFinite(num(r[field])) ? num(r[field]) : 0), 0);

  const save = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      await saveCodeMonths(
        Object.entries(draft).map(([month, r]) => ({
          month,
          commits: num(r.commits),
          linesAdded: num(r.linesAdded),
          linesDeleted: num(r.linesDeleted),
        }))
      );
      setOk('Saved.');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      icon={GitCommitHorizontal}
      title="Code by month"
      description="From GitHub's contributor activity: commits, lines added and lines deleted for each month this year."
      actions={
        <button onClick={save} disabled={saving} className={PRIMARY_BTN}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save
        </button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted uppercase tracking-wider">
              <th className="py-1.5 pr-3 font-medium">Month</th>
              <th className="py-1.5 px-1.5 font-medium">Commits</th>
              <th className="py-1.5 px-1.5 font-medium">Lines added</th>
              <th className="py-1.5 px-1.5 font-medium">Lines deleted</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(draft).map(([month, r]) => (
              <tr key={month}>
                <td className="py-1 pr-3 text-zinc-300 whitespace-nowrap">{MONTHS[Number(month.slice(5, 7)) - 1]}</td>
                {(['commits', 'linesAdded', 'linesDeleted'] as Field[]).map(f => (
                  <td key={f} className="py-1 px-1.5">
                    <input
                      inputMode="numeric"
                      value={r[f]}
                      onChange={e => setCell(month, f, e.target.value)}
                      placeholder="0"
                      className={`${INPUT} text-right tabular-nums`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-zinc-200 font-medium border-t border-zinc-800">
              <td className="pt-2 pr-3">Total</td>
              {(['commits', 'linesAdded', 'linesDeleted'] as Field[]).map(f => (
                <td key={f} className="pt-2 px-4 text-right tabular-nums">
                  {totals(f).toLocaleString()}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <StatusLine error={error} ok={ok} />
    </Section>
  );
}
