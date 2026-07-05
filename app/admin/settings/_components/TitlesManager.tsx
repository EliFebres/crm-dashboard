'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Check, X, Loader2, Trash2, Award } from 'lucide-react';
import { DeleteOrgModal } from '@/app/admin/settings/_components/OrgSection';
import { SortableList, SortableBody, SortableRow } from '@/app/admin/settings/_components/sortable';
import {
  getTitles, createTitle, renameTitle, deleteTitle, reorderTitles,
  TitleConflictError, type TitleItem,
} from '@/app/lib/api/titles';
import { useRowFlashes, FLASH_CLASS, FLASH_TEXT_CLASS, type FieldSpec } from '@/app/lib/hooks/useRowFlashes';
import { useSettingsStream } from '@/app/lib/hooks/useSettingsStream';

function errMsg(err: unknown, fallback: string): string {
  return err instanceof TitleConflictError || err instanceof Error ? err.message : fallback;
}

// Refetch on title edits plus roster/user reassignments (they shift "in use").
const TITLE_LIVE = ['title', 'team_member', 'user'];
const TITLE_FLASH_SPECS: FieldSpec<TitleItem>[] = [
  { key: 'name', get: r => r.name },
  { key: 'assigned', get: r => r.assignedCount, kind: (a, b) => (Number(b) > Number(a) ? 'blue' : 'neutral') },
];

/**
 * Full-width admin manager for the rank Titles list. Order = rank, set by drag.
 * People pick from these titles at sign-up and admins reassign them for promotions.
 */
export default function TitlesManager() {
  const [items, setItems] = useState<TitleItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const [deleting, setDeleting] = useState<TitleItem | null>(null);

  const flashes = useRowFlashes(items, TITLE_FLASH_SPECS);
  const cellFlash = (id: string, key: string) => {
    const t = flashes.cells.get(id)?.[key];
    return t ? FLASH_TEXT_CLASS[t.kind] : '';
  };
  const rowFlash = (id: string) => (flashes.newIds.has(id) ? FLASH_CLASS.neutral : '');

  const load = useCallback(() => {
    setLoading(true);
    getTitles().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);

  // Silent refetch (no loading flicker) for live updates, so the flash shows.
  const refetch = useCallback(() => {
    getTitles().then(setItems).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const onStream = useCallback((entity: string) => {
    if (TITLE_LIVE.includes(entity)) refetch();
  }, [refetch]);
  useSettingsStream(onStream);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) { setAddError('A title name is required.'); return; }
    setAddBusy(true); setAddError('');
    try {
      const created = await createTitle(name);
      setShowAdd(false); setAddName('');
      setItems(prev => [...prev, created]); // optimistic append → new-row flash
    } catch (err) {
      setAddError(errMsg(err, 'Failed to add title.'));
    } finally {
      setAddBusy(false);
    }
  };

  const startEdit = (item: TitleItem) => {
    setEditingId(item.id); setEditName(item.name); setEditError('');
  };

  const handleSave = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    setEditBusy(true); setEditError('');
    const startItems = items;
    setItems(cur => cur.map(i => (i.id === id ? { ...i, name } : i))); // optimistic rename
    try {
      const updated = await renameTitle(id, name);
      setItems(cur => cur.map(i => (i.id === id ? updated : i)));
      setEditingId(null);
    } catch (err) {
      setItems(startItems); // revert on failure
      setEditError(errMsg(err, 'Failed to rename title.'));
    } finally {
      setEditBusy(false);
    }
  };

  // Optimistically apply the new rank order, then persist; revert on failure.
  const handleReorder = async (nextIds: string[]) => {
    const byId = new Map(items.map(i => [i.id, i]));
    const next = nextIds.map(id => byId.get(id)).filter((x): x is TitleItem => Boolean(x));
    const prev = items;
    setItems(next);
    try {
      await reorderTitles(nextIds);
    } catch {
      setItems(prev);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <Award className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-base font-semibold text-white">Titles</h3>
            <p className="text-muted text-xs">The rank titles people pick from — drag to set their rank. Shown in the sign-up and team-member forms.</p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddName(''); setAddError(''); }}
          className="flex items-center gap-1.5 px-3 py-2 shrink-0 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add title
        </button>
      </div>

      {showAdd && (
        <div className="max-w-md space-y-2 p-4 bg-zinc-900/60 border border-zinc-800/50 rounded-lg">
          <p className="text-sm font-medium text-zinc-200">Add a new title</p>
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Title name"
            autoFocus
            className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={addBusy} className="px-3 py-1.5 text-sm rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors">
              {addBusy ? 'Saving…' : 'Add'}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm rounded-lg bg-zinc-700/50 text-muted hover:bg-zinc-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <SortableList ids={items.map(i => i.id)} onReorder={handleReorder}>
      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg overflow-x-auto scrollbar-thin">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/50 text-left">
              <th className="w-8" />
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider w-16">Rank</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Title</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">In use</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted text-sm">No titles yet.</td></tr>
            ) : (
              <SortableBody ids={items.map(i => i.id)}>
                {items.map((item, index) => {
                const editing = editingId === item.id;
                const inUse = item.assignedCount > 0;
                return (
                  <SortableRow key={item.id} id={item.id} disabled={editing} className={`border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-middle ${rowFlash(item.id)}`}>
                    <td className="px-4 py-3 text-center text-sm font-medium text-muted tabular-nums">{index + 1}</td>
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(item.id); }}
                            className="w-full max-w-sm px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50"
                            autoFocus
                            title="Name"
                          />
                          {editError && <p className="text-xs text-red-400">{editError}</p>}
                        </div>
                      ) : (
                        <span className={`text-sm text-zinc-200 ${cellFlash(item.id, 'name')}`}>{item.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-muted"><span className={cellFlash(item.id, 'assigned')}>{item.assignedCount}</span></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {editing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleSave(item.id)} disabled={editBusy} className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50" title="Save"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 rounded text-muted hover:bg-zinc-700/50" title="Cancel"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(item)} className="p-1.5 rounded text-muted hover:text-cyan-400 hover:bg-white/[0.05] transition-colors" title="Rename"><Pencil className="w-4 h-4" /></button>
                          <button
                            onClick={() => { if (!inUse) setDeleting(item); }}
                            disabled={inUse}
                            className={inUse ? 'p-1.5 rounded text-muted opacity-40 cursor-not-allowed' : 'p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors'}
                            title={inUse ? `Can't delete — ${item.assignedCount} person/people still hold this title. Reassign them first.` : 'Delete title'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </SortableRow>
                );
                })}
              </SortableBody>
            )}
          </tbody>
        </table>
      </div>
      </SortableList>

      {deleting && (
        <DeleteOrgModal
          item={deleting}
          singular="title"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteTitle(deleting.id); setItems(prev => prev.filter(i => i.id !== deleting.id)); }}
        />
      )}
    </section>
  );
}
