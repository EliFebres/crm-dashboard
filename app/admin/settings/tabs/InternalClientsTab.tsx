'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Check, X, Loader2, Trash2, Layers, Contact, Search } from 'lucide-react';
import { Select } from '@/app/components/ui/Select';
import { DeleteOrgModal } from '@/app/admin/settings/_components/OrgSection';
import {
  getDepartments, createDepartment, updateDepartment, deleteDepartment,
  listInternalClients, createInternalClient, updateInternalClient, deleteInternalClient,
  RegistryConflictError,
  type DepartmentItem, type InternalClientItem,
} from '@/app/lib/api/internal-clients';

const DEFAULT_COLOR = '#22d3ee';

function errMsg(err: unknown, fallback: string): string {
  return err instanceof RegistryConflictError || err instanceof Error ? err.message : fallback;
}

// ── Departments ──────────────────────────────────────────────────────────────

function DepartmentSection({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<DepartmentItem[]>([]);
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

  const [deleting, setDeleting] = useState<DepartmentItem | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getDepartments().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) { setAddError('A department name is required.'); return; }
    setAddBusy(true); setAddError('');
    try {
      await createDepartment(name, addColor);
      setShowAdd(false); setAddName(''); setAddColor(DEFAULT_COLOR);
      load(); onChanged();
    } catch (err) {
      setAddError(errMsg(err, 'Failed to add department.'));
    } finally {
      setAddBusy(false);
    }
  };

  const startEdit = (item: DepartmentItem) => {
    setEditingId(item.id); setEditName(item.name); setEditColor(item.color); setEditError('');
  };

  const handleSave = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    setEditBusy(true); setEditError('');
    try {
      await updateDepartment(id, { name, color: editColor });
      setEditingId(null);
      load(); onChanged();
    } catch (err) {
      setEditError(errMsg(err, 'Failed to update department.'));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-base font-semibold text-white">Departments</h3>
            <p className="text-muted text-xs">Internal client departments and their chart colors</p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddName(''); setAddColor(DEFAULT_COLOR); setAddError(''); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add department
        </button>
      </div>

      {showAdd && (
        <div className="max-w-md space-y-2 p-4 bg-zinc-900/60 border border-zinc-800/50 rounded-lg">
          <p className="text-sm font-medium text-zinc-200">Add a new department</p>
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
              placeholder="Department name"
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
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Department</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">In use</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-muted"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-10 text-center text-muted text-sm">No departments yet.</td></tr>
            ) : (
              items.map(item => {
                const editing = editingId === item.id;
                const inUse = item.assignedCount > 0;
                return (
                  <tr key={item.id} className="border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-middle">
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
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-muted">{item.assignedCount}</td>
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
                            onClick={() => { if (!inUse) setDeleting(item); }}
                            disabled={inUse}
                            className={inUse ? 'p-1.5 rounded text-muted opacity-40 cursor-not-allowed' : 'p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors'}
                            title={inUse ? `Can't delete — ${item.assignedCount} engagement(s)/internal client(s) still use this department.` : 'Delete department'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {deleting && (
        <DeleteOrgModal
          item={deleting}
          singular="department"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteDepartment(deleting.id); load(); onChanged(); }}
        />
      )}
    </section>
  );
}

// ── Internal Clients ─────────────────────────────────────────────────────────

function InternalClientSection({ departments }: { departments: string[] }) {
  const [items, setItems] = useState<InternalClientItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addDept, setAddDept] = useState('');
  const [addError, setAddError] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const [deleting, setDeleting] = useState<InternalClientItem | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    listInternalClients().then(setItems).catch(() => setItems([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? items.filter(c => c.name.toLowerCase().includes(q) || c.department.toLowerCase().includes(q))
    : items;

  const handleAdd = async () => {
    const name = addName.trim();
    const dept = addDept || departments[0] || '';
    if (!name) { setAddError('An internal client name is required.'); return; }
    if (!dept) { setAddError('Select a department.'); return; }
    setAddBusy(true); setAddError('');
    try {
      await createInternalClient(name, dept);
      setShowAdd(false); setAddName(''); setAddDept('');
      load();
    } catch (err) {
      setAddError(errMsg(err, 'Failed to add internal client.'));
    } finally {
      setAddBusy(false);
    }
  };

  const startEdit = (item: InternalClientItem) => {
    setEditingId(item.id); setEditName(item.name); setEditDept(item.department); setEditError('');
  };

  const handleSave = async (id: string) => {
    const name = editName.trim();
    if (!name) { setEditError('Name is required.'); return; }
    setEditBusy(true); setEditError('');
    try {
      await updateInternalClient(id, { name, department: editDept });
      setEditingId(null);
      load();
    } catch (err) {
      setEditError(errMsg(err, 'Failed to update internal client.'));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <Contact className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-base font-semibold text-white">Internal Clients</h3>
            <p className="text-muted text-xs">Internal contacts shown in the New Interaction form</p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddName(''); setAddDept(departments[0] ?? ''); setAddError(''); }}
          disabled={departments.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          title={departments.length === 0 ? 'Add a department first' : 'Add internal client'}
        >
          <Plus className="w-4 h-4" />
          Add internal client
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or department..."
          className="w-full pl-9 pr-3 py-2 bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/30 transition-colors"
        />
      </div>

      {showAdd && (
        <div className="max-w-lg space-y-2 p-4 bg-zinc-900/60 border border-zinc-800/50 rounded-lg">
          <p className="text-sm font-medium text-zinc-200">Add a new internal client</p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="Internal client name"
              autoFocus
              className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            <div className="w-44 shrink-0">
              <Select value={addDept || departments[0] || ''} onValueChange={setAddDept} options={departments} placeholder="Department" />
            </div>
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
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Name</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Department</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-muted uppercase tracking-wider">In use</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted text-sm">{q ? 'No matching internal clients.' : 'No internal clients yet.'}</td></tr>
            ) : (
              filtered.map(item => {
                const editing = editingId === item.id;
                const inUse = item.assignedCount > 0;
                return (
                  <tr key={item.id} className="border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-middle">
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
                    <td className="px-4 py-3">
                      {editing ? (
                        <div className="w-40">
                          <Select value={editDept} onValueChange={setEditDept} options={departments} placeholder="Department" />
                        </div>
                      ) : (
                        <span className="text-sm text-muted">{item.department}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-muted">{item.assignedCount}</td>
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
                            onClick={() => { if (!inUse) setDeleting(item); }}
                            disabled={inUse}
                            className={inUse ? 'p-1.5 rounded text-muted opacity-40 cursor-not-allowed' : 'p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors'}
                            title={inUse ? `Can't delete — ${item.assignedCount} engagement(s) still reference this internal client.` : 'Delete internal client'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {deleting && (
        <DeleteOrgModal
          item={deleting}
          singular="internal client"
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await deleteInternalClient(deleting.id); load(); }}
        />
      )}
    </section>
  );
}

/** Internal Clients tab — manage departments (with colors) and the internal-client registry. */
export default function InternalClientsTab() {
  const [departments, setDepartments] = useState<string[]>([]);

  const loadDepartments = useCallback(() => {
    getDepartments().then(items => setDepartments(items.map(d => d.name))).catch(() => setDepartments([]));
  }, []);

  useEffect(() => { loadDepartments(); }, [loadDepartments]);

  return (
    <div className="space-y-8">
      <DepartmentSection onChanged={loadDepartments} />
      <InternalClientSection departments={departments} />
    </div>
  );
}
