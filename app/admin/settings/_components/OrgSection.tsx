'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Check, X, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { type OrgItem, OrgConflictError } from '@/app/lib/api/org';
import { SortableList, SortableBody, SortableRow } from '@/app/admin/settings/_components/sortable';

export interface OrgApi {
  list: () => Promise<OrgItem[]>;
  create: (name: string) => Promise<OrgItem>;
  rename: (id: string, name: string) => Promise<OrgItem>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}

/** Modal requiring the admin to type the exact name before a delete is allowed. */
export function DeleteOrgModal({
  item, singular, onClose, onConfirm,
}: {
  item: { name: string };
  singular: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === item.name;

  async function handleDelete() {
    if (!matches) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${singular}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h2 className="text-base font-semibold text-zinc-100">Delete {singular}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-zinc-200 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted">
            This permanently deletes the {singular}{' '}
            <span className="text-zinc-100 font-medium">{item.name}</span>. Type its name to confirm.
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={item.name}
            autoFocus
            className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-red-500/50 transition-colors"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-muted hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={!matches || busy}
              className="px-4 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Deleting…' : `Delete ${singular}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reusable admin manager for an editable list (Teams or Offices). */
export function OrgSection({
  title, singular, icon, api, align = 'left',
}: {
  title: string;
  singular: string;
  icon: React.ReactNode;
  api: OrgApi;
  /** Horizontal alignment of the (capped-width) card within its container. */
  align?: 'left' | 'right';
}) {
  // Pushes the max-w-md blocks to the right edge when the card is right-aligned.
  const alignCls = align === 'right' ? 'ml-auto' : '';
  const [items, setItems] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const [deleting, setDeleting] = useState<OrgItem | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.list().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) { setAddError(`A ${singular} name is required.`); return; }
    setAddBusy(true);
    setAddError('');
    try {
      await api.create(name);
      setShowAdd(false);
      setAddName('');
      load();
    } catch (err) {
      setAddError(err instanceof OrgConflictError || err instanceof Error ? err.message : `Failed to add ${singular}.`);
    } finally {
      setAddBusy(false);
    }
  };

  const startEdit = (item: OrgItem) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditError('');
  };

  const handleSave = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    setEditBusy(true);
    setEditError('');
    try {
      await api.rename(id, name);
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(err instanceof OrgConflictError || err instanceof Error ? err.message : 'Failed to rename.');
    } finally {
      setEditBusy(false);
    }
  };

  // Optimistically apply the new order, then persist; revert on failure.
  const handleReorder = async (nextIds: string[]) => {
    const byId = new Map(items.map(i => [i.id, i]));
    const next = nextIds.map(id => byId.get(id)).filter((x): x is OrgItem => Boolean(x));
    const prev = items;
    setItems(next);
    try {
      await api.reorder(nextIds);
    } catch {
      setItems(prev);
    }
  };

  return (
    <section className="space-y-4">
      <div className={`flex items-end justify-between gap-4 max-w-md ${alignCls}`}>
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-muted text-xs">Shown in the sign-up and team-member forms</p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddName(''); setAddError(''); }}
          className="flex items-center gap-1.5 px-3 py-2 shrink-0 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add {singular}
        </button>
      </div>

      {showAdd && (
        <div className={`max-w-md space-y-2 p-4 bg-zinc-900/60 border border-zinc-800/50 rounded-lg ${alignCls}`}>
          <p className="text-sm font-medium text-zinc-200">Add a new {singular}</p>
          <input
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder={`${singular[0].toUpperCase()}${singular.slice(1)} name`}
            autoFocus
            className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
          {addError && <p className="text-xs text-red-400">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={addBusy}
              className="px-3 py-1.5 text-sm rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
            >
              {addBusy ? 'Saving…' : 'Add'}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-sm rounded-lg bg-zinc-700/50 text-muted hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <SortableList ids={items.map(i => i.id)} onReorder={handleReorder}>
      <div className={`bg-zinc-900/40 border border-zinc-800/50 rounded-lg overflow-hidden max-w-md ${alignCls}`}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/50 text-left">
              <th className="w-8" />
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Name</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">Assigned</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted">
                  <Loader2 className="w-5 h-5 animate-spin inline" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted text-sm">No {title.toLowerCase()} yet.</td>
              </tr>
            ) : (
              <SortableBody ids={items.map(i => i.id)}>
                {items.map(item => {
                const editing = editingId === item.id;
                const inUse = item.assignedCount > 0;
                return (
                  <SortableRow key={item.id} id={item.id} disabled={editing} className="border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-middle">
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(item.id); }}
                            className="w-full px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50"
                            autoFocus
                            title="Name"
                          />
                          {editError && <p className="text-xs text-red-400">{editError}</p>}
                        </div>
                      ) : (
                        <span className="text-sm text-zinc-200">{item.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-muted">{item.assignedCount}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {editing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleSave(item.id)}
                            disabled={editBusy}
                            className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 rounded text-muted hover:bg-zinc-700/50"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEdit(item)}
                            className="p-1.5 rounded text-muted hover:text-cyan-400 hover:bg-white/[0.05] transition-colors"
                            title="Rename"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => { if (!inUse) setDeleting(item); }}
                            disabled={inUse}
                            className={
                              inUse
                                ? 'p-1.5 rounded text-muted opacity-40 cursor-not-allowed'
                                : 'p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors'
                            }
                            title={
                              inUse
                                ? `Can't delete — ${item.assignedCount} user(s)/member(s) are still assigned. Reassign them first.`
                                : `Delete ${singular}`
                            }
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
          singular={singular}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.remove(deleting.id); load(); }}
        />
      )}
    </section>
  );
}
