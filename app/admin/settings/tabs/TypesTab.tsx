'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Check, X, Loader2, Trash2, FolderKanban, Inbox, Lock } from 'lucide-react';
import { DeleteOrgModal } from '@/app/admin/settings/_components/OrgSection';
import { SortableList, SortableRow } from '@/app/admin/settings/_components/sortable';
import {
  getProjectTypes, createProjectType, updateProjectType, deleteProjectType, reorderProjectTypes,
  getIntakeTypes, createIntakeType, updateIntakeType, deleteIntakeType, reorderIntakeTypes,
  RegistryConflictError,
  type ProjectTypeItem, type IntakeTypeItem,
} from '@/app/lib/api/types';

const DEFAULT_COLOR = '#22d3ee';

function errMsg(err: unknown, fallback: string): string {
  return err instanceof RegistryConflictError || err instanceof Error ? err.message : fallback;
}

/** Shared shape across project + intake types — both carry a color and an optional built-in role. */
interface TypeItem {
  id: string;
  name: string;
  color: string;
  role: string | null;
  assignedCount: number;
}

interface TypeApi<T extends TypeItem> {
  list: () => Promise<T[]>;
  create: (name: string, color?: string) => Promise<T>;
  update: (id: string, patch: { name?: string; color?: string }) => Promise<T>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}

/**
 * A color-managed CRUD table for an editable type registry. Built-ins (role != null)
 * can be renamed and recolored but not deleted — the app has features hardwired to them.
 */
function TypeSection<T extends TypeItem>({
  title, description, singular, icon, api,
}: {
  title: string;
  description: string;
  singular: string;
  icon: React.ReactNode;
  api: TypeApi<T>;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addColor, setAddColor] = useState(DEFAULT_COLOR);
  const [addError, setAddError] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const [deleting, setDeleting] = useState<T | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.list().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) { setAddError(`A ${singular} name is required.`); return; }
    setAddBusy(true); setAddError('');
    try {
      await api.create(name, addColor);
      setShowAdd(false); setAddName(''); setAddColor(DEFAULT_COLOR);
      load();
    } catch (err) {
      setAddError(errMsg(err, `Failed to add ${singular}.`));
    } finally {
      setAddBusy(false);
    }
  };

  const startEdit = (item: T) => {
    setEditingId(item.id); setEditName(item.name); setEditColor(item.color); setEditError('');
  };

  const handleSave = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    setEditBusy(true); setEditError('');
    try {
      await api.update(id, { name, color: editColor });
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(errMsg(err, `Failed to update ${singular}.`));
    } finally {
      setEditBusy(false);
    }
  };

  // Optimistically apply the new order, then persist; revert on failure.
  const handleReorder = async (nextIds: string[]) => {
    const byId = new Map(items.map(i => [i.id, i]));
    const next = nextIds.map(id => byId.get(id)).filter((x): x is T => Boolean(x));
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
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-muted text-xs">{description}</p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddName(''); setAddColor(DEFAULT_COLOR); setAddError(''); }}
          className="flex items-center gap-1.5 px-3 py-2 shrink-0 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add {singular}
        </button>
      </div>

      {showAdd && (
        <div className="max-w-md space-y-2 p-4 bg-zinc-900/60 border border-zinc-800/50 rounded-lg">
          <p className="text-sm font-medium text-zinc-200">Add a new {singular}</p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={addColor}
              onChange={(e) => setAddColor(e.target.value)}
              className="h-9 w-10 shrink-0 rounded border border-zinc-700 bg-zinc-800/50 cursor-pointer"
              title="Chart color"
            />
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder={`${singular[0].toUpperCase()}${singular.slice(1)} name`}
              autoFocus
              className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
          </div>
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

      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg overflow-x-auto scrollbar-thin">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/50 text-left">
              <th className="w-8" />
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">{title.replace(/s$/, '')}</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">In use</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted text-sm">No {title.toLowerCase()} yet.</td></tr>
            ) : (
              <SortableList ids={items.map(i => i.id)} onReorder={handleReorder}>
                {items.map(item => {
                const editing = editingId === item.id;
                const inUse = item.assignedCount > 0;
                const isBuiltIn = item.role !== null;
                // Built-ins are hardwired into KPI logic — rename allowed, delete blocked.
                const lockDelete = isBuiltIn || inUse;
                const deleteTitle = isBuiltIn
                  ? `"${item.name}" is a built-in ${singular} — rename allowed, delete disabled.`
                  : inUse
                    ? `Can't delete — ${item.assignedCount} engagement(s) still use this ${singular}.`
                    : `Delete ${singular}`;
                return (
                  <SortableRow key={item.id} id={item.id} disabled={editing} className="border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-top">
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={editColor}
                              onChange={(e) => setEditColor(e.target.value)}
                              className="h-8 w-9 shrink-0 rounded border border-zinc-700 bg-zinc-800/50 cursor-pointer"
                              title="Chart color"
                            />
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(item.id); }}
                              className="w-full px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50"
                              autoFocus
                              title="Name"
                            />
                          </div>
                          {editError && <p className="text-xs text-red-400">{editError}</p>}
                        </div>
                      ) : (
                        <span className="flex items-center gap-2 text-sm text-zinc-200">
                          <span className="w-3 h-3 rounded-sm shrink-0 border border-white/10" style={{ backgroundColor: item.color }} />
                          {item.name}
                          {isBuiltIn && (
                            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted" title="Built-in — cannot be deleted">
                              <Lock className="w-3 h-3" /> Built-in
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">{item.assignedCount}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {editing ? (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleSave(item.id)} disabled={editBusy} className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50" title="Save"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingId(null)} className="p-1.5 rounded text-muted hover:bg-zinc-700/50" title="Cancel"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => startEdit(item)} className="p-1.5 rounded text-muted hover:text-cyan-400 hover:bg-white/[0.05] transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
                          <button
                            onClick={() => { if (!lockDelete) setDeleting(item); }}
                            disabled={lockDelete}
                            className={lockDelete ? 'p-1.5 rounded text-muted opacity-40 cursor-not-allowed' : 'p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors'}
                            title={deleteTitle}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </SortableRow>
                );
                })}
              </SortableList>
            )}
          </tbody>
        </table>
      </div>

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

const projectTypeApi: TypeApi<ProjectTypeItem> = {
  list: getProjectTypes,
  create: createProjectType,
  update: updateProjectType,
  remove: deleteProjectType,
  reorder: reorderProjectTypes,
};

const intakeTypeApi: TypeApi<IntakeTypeItem> = {
  list: getIntakeTypes,
  create: createIntakeType,
  update: updateIntakeType,
  remove: deleteIntakeType,
  reorder: reorderIntakeTypes,
};

/** Types tab — manage the project types and intake types used across client engagements. */
export default function TypesTab() {
  return (
    <div className="space-y-8">
      <TypeSection
        title="Project Types"
        description="The kind of work an engagement represents (shown in the New Interaction form)"
        singular="project type"
        icon={<FolderKanban className="w-5 h-5 text-cyan-400" />}
        api={projectTypeApi}
      />
      <TypeSection
        title="Intake Types"
        description="How an engagement enters the pipeline. IRQ, SERF and Ad-Hoc are built-in and can be renamed but not deleted."
        singular="intake type"
        icon={<Inbox className="w-5 h-5 text-cyan-400" />}
        api={intakeTypeApi}
      />
    </div>
  );
}
