'use client';

import React, { useEffect, useState } from 'react';
import { Wrench, Loader2, Plus, Trash2, Check } from 'lucide-react';
import {
  createDevTool,
  updateDevTool,
  deleteDevTool,
  DEV_TOOL_STATUSES,
  DEV_TOOL_PALETTE,
  type DevTool,
  type DevToolInput,
  type DevToolStatus,
} from '@/app/lib/api/dev-report';
import { INPUT, PRIMARY_BTN, SECONDARY_BTN, Section, StatusLine } from './ui';

type Draft = {
  name: string;
  status: DevToolStatus;
  launchedOn: string;
  minutesSavedPerUse: string;
  usersReached: string;
  description: string;
};

function toDraft(t: DevTool): Draft {
  return {
    name: t.name,
    status: t.status,
    launchedOn: t.launchedOn ?? '',
    minutesSavedPerUse: t.minutesSavedPerUse == null ? '' : String(t.minutesSavedPerUse),
    usersReached: t.usersReached == null ? '' : String(t.usersReached),
    description: t.description ?? '',
  };
}

function toInput(d: Draft): DevToolInput {
  return {
    name: d.name,
    status: d.status,
    launchedOn: d.launchedOn || null,
    minutesSavedPerUse: d.minutesSavedPerUse.trim() === '' ? null : Number(d.minutesSavedPerUse),
    usersReached: d.usersReached.trim() === '' ? null : Number(d.usersReached),
    description: d.description,
  };
}

const sameDraft = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every(k => a[k] === b[k]);

function ToolRow({ tool, color, onChanged }: { tool: DevTool; color: string; onChanged: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(tool));
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(toDraft(tool)), [tool]);
  const dirty = !sameDraft(draft, toDraft(tool));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      await updateDevTool(tool.id, toInput(draft));
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const usage = tool.usesYtd > 0 ? ` and its ${tool.usesYtd.toLocaleString()} recorded uses` : '';
    if (!window.confirm(`Delete "${tool.name}"${usage}? This can't be undone.`)) return;
    setBusy('delete');
    setError(null);
    try {
      await deleteDevTool(tool.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <>
      <tr className="align-top">
        <td className="py-1 pr-1.5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
            <input value={draft.name} onChange={e => set('name', e.target.value)} className={INPUT} />
          </div>
        </td>
        <td className="py-1 px-1.5">
          <select value={draft.status} onChange={e => set('status', e.target.value as DevToolStatus)} className={INPUT}>
            {DEV_TOOL_STATUSES.map(s => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </td>
        <td className="py-1 px-1.5">
          <input type="date" value={draft.launchedOn} onChange={e => set('launchedOn', e.target.value)} className={`${INPUT} [color-scheme:dark]`} />
        </td>
        <td className="py-1 px-1.5">
          <input inputMode="decimal" value={draft.minutesSavedPerUse} onChange={e => set('minutesSavedPerUse', e.target.value)} placeholder="—" className={`${INPUT} text-right`} />
        </td>
        <td className="py-1 px-1.5">
          <input inputMode="numeric" value={draft.usersReached} onChange={e => set('usersReached', e.target.value)} placeholder="—" className={`${INPUT} text-right`} />
        </td>
        <td className="py-1 px-1.5">
          <input value={draft.description} onChange={e => set('description', e.target.value)} placeholder="What it does" className={INPUT} />
        </td>
        <td className="py-1 px-1.5 text-right text-zinc-300 tabular-nums whitespace-nowrap pt-2.5">{tool.usesYtd.toLocaleString()}</td>
        <td className="py-1 pl-1.5">
          <div className="flex items-center gap-1 pt-0.5">
            <button
              onClick={save}
              disabled={!dirty || busy !== null}
              title="Save changes"
              className="p-1.5 rounded-md text-cyan-400 hover:bg-cyan-500/10 disabled:text-zinc-600 disabled:hover:bg-transparent"
            >
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button
              onClick={remove}
              disabled={busy !== null}
              title="Delete tool"
              className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              {busy === 'delete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={8} className="pb-1">
            <StatusLine error={error} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The tool inventory: status, launch date, minutes saved per use and users reached. */
export default function ToolsEditor({ tools, onChanged }: { tools: DevTool[]; onChanged: () => void }) {
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await createDevTool({ name: newName });
      setNewName('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Section
      icon={Wrench}
      title="Tool inventory"
      description="Every tool you've built. Minutes saved per use drives the hours-saved figures; tools from a usage import are added here automatically."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="text-left text-xs text-muted uppercase tracking-wider">
              <th className="py-1.5 pr-1.5 font-medium w-[20%]">Tool</th>
              <th className="py-1.5 px-1.5 font-medium w-[10%]">Status</th>
              <th className="py-1.5 px-1.5 font-medium w-[13%]">Launched</th>
              <th className="py-1.5 px-1.5 font-medium w-[9%]" title="Estimated minutes one use saves">Min saved / use</th>
              <th className="py-1.5 px-1.5 font-medium w-[8%]">Users</th>
              <th className="py-1.5 px-1.5 font-medium">Description</th>
              <th className="py-1.5 px-1.5 font-medium text-right w-[8%]">Uses YTD</th>
              <th className="w-[70px]" />
            </tr>
          </thead>
          <tbody>
            {tools.map((t, i) => (
              <ToolRow key={t.id} tool={t} color={DEV_TOOL_PALETTE[i % DEV_TOOL_PALETTE.length]} onChanged={onChanged} />
            ))}
            {tools.length === 0 && (
              <tr>
                <td colSpan={8} className="py-3 text-muted text-sm">
                  No tools yet. Add one below, or import usage and they&apos;ll appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 mt-3 max-w-md">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New tool name"
          className={INPUT}
        />
        <button onClick={add} disabled={adding || !newName.trim()} className={newName.trim() ? PRIMARY_BTN : SECONDARY_BTN}>
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add
        </button>
      </div>
      <StatusLine error={error} />
    </Section>
  );
}
