'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Settings, Building2, Search, Plus, Pencil, Check, X, Loader2, Users, Trash2, AlertTriangle } from 'lucide-react';
import { useCurrentUser } from '@/app/lib/auth/context';
import {
  getClients, registerClient, updateClient, getCrnConfig,
  CrnConfigResponse, ClientConflictError,
} from '@/app/lib/api/client-interactions';
import {
  getTeams, createTeam, renameTeam, deleteTeam,
  getOffices, createOffice, renameOffice, deleteOffice,
  type OrgItem, OrgConflictError,
} from '@/app/lib/api/org';
import type { Client } from '@/app/lib/types/engagements';

// Stable, module-level API bundles so <OrgSection>'s effects don't re-run each render.
const TEAM_API = { list: getTeams, create: createTeam, rename: renameTeam, remove: deleteTeam };
const OFFICE_API = { list: getOffices, create: createOffice, rename: renameOffice, remove: deleteOffice };

interface OrgApi {
  list: () => Promise<OrgItem[]>;
  create: (name: string) => Promise<OrgItem>;
  rename: (id: string, name: string) => Promise<OrgItem>;
  remove: (id: string) => Promise<void>;
}

/** Modal requiring the admin to type the exact name before a delete is allowed. */
function DeleteOrgModal({
  item, singular, onClose, onConfirm,
}: {
  item: OrgItem;
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
function OrgSection({
  title, singular, icon, api,
}: {
  title: string;
  singular: string;
  icon: React.ReactNode;
  api: OrgApi;
}) {
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

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-muted text-xs">Shown in the sign-up and team-member forms</p>
          </div>
        </div>
        <button
          onClick={() => { setShowAdd(true); setAddName(''); setAddError(''); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add {singular}
        </button>
      </div>

      {showAdd && (
        <div className="max-w-md space-y-2 p-4 bg-zinc-900/60 border border-zinc-800/50 rounded-lg">
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

      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg overflow-hidden max-w-md">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800/50 text-left">
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Name</th>
              <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Assigned</th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted">
                  <Loader2 className="w-5 h-5 animate-spin inline" />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-muted text-sm">No {title.toLowerCase()} yet.</td>
              </tr>
            ) : (
              items.map(item => {
                const editing = editingId === item.id;
                const inUse = item.assignedCount > 0;
                return (
                  <tr key={item.id} className="border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-top">
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
                    <td className="px-4 py-3 text-sm text-muted">{item.assignedCount}</td>
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
          singular={singular}
          onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.remove(deleting.id); load(); }}
        />
      )}
    </section>
  );
}

export default function SettingsPage() {
  const { user, isLoading: userLoading } = useCurrentUser();
  const isAdmin = user?.role === 'admin';

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [crnConfig, setCrnConfig] = useState<CrnConfigResponse | null>(null);

  // Register form
  const [showRegister, setShowRegister] = useState(false);
  const [regName, setRegName] = useState('');
  const [regCrn, setRegCrn] = useState('');
  const [regError, setRegError] = useState('');
  const [regBusy, setRegBusy] = useState(false);

  // Inline edit (name + CRN). `editingCrn` holds the row's CURRENT crn as identity.
  const [editingCrn, setEditingCrn] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCrnValue, setEditCrnValue] = useState('');
  const [editError, setEditError] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  const load = useCallback((q: string) => {
    setLoading(true);
    getClients(q.trim())
      .then(setClients)
      .catch(() => setClients([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    getCrnConfig().then(setCrnConfig).catch(() => setCrnConfig({ autoGenerate: false, prefix: '' }));
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const handle = setTimeout(() => load(search), 200);
    return () => clearTimeout(handle);
  }, [isAdmin, search, load]);

  const handleRegister = async () => {
    const name = regName.trim();
    if (!name) { setRegError('Client name is required.'); return; }
    const manual = !crnConfig?.autoGenerate;
    const crn = regCrn.trim();
    if (manual && !crn) { setRegError('CRN is required.'); return; }
    setRegBusy(true);
    setRegError('');
    try {
      await registerClient(name, manual ? crn : undefined);
      setShowRegister(false);
      setRegName('');
      setRegCrn('');
      load(search);
    } catch (err) {
      setRegError(
        err instanceof ClientConflictError ? err.message
          : err instanceof Error ? err.message
          : 'Failed to register client.'
      );
    } finally {
      setRegBusy(false);
    }
  };

  const startEdit = (c: Client) => {
    setEditingCrn(c.crn);
    setEditName(c.name);
    setEditCrnValue(c.crn);
    setEditError('');
  };

  const handleSave = async (currentCrn: string) => {
    const name = editName.trim();
    const crn = editCrnValue.trim();
    if (!name) { setEditError('Name is required.'); return; }
    if (!crn) { setEditError('CRN is required.'); return; }
    setEditBusy(true);
    setEditError('');
    try {
      const updated = await updateClient(currentCrn, { name, crn });
      setClients(prev => prev.map(c => (c.crn === currentCrn ? { crn: updated.crn, name: updated.name, createdByName: c.createdByName } : c)));
      setEditingCrn(null);
    } catch (err) {
      setEditError(
        err instanceof ClientConflictError ? err.message
          : err instanceof Error ? err.message
          : 'Failed to update client.'
      );
    } finally {
      setEditBusy(false);
    }
  };

  // Gate: admins only. Wait for the user to load before deciding.
  if (userLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-muted animate-spin" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="p-10 max-w-md text-center bg-zinc-900/40 border border-zinc-800/50 rounded-xl">
          <Settings className="w-10 h-10 text-cyan-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Admin access only</h2>
          <p className="text-sm text-muted">Settings are restricted to administrators.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="flex-shrink-0 bg-transparent backdrop-blur-md border-b border-zinc-800/50 relative z-50 sticky top-0">
        <div className="px-6 pt-6 pb-3">
          <div className="flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-cyan-400" />
            <div>
              <h2 className="text-xl font-semibold text-white">Settings</h2>
              <p className="text-muted text-sm">Administer the workspace</p>
            </div>
          </div>
        </div>
      </header>

      <div className="px-6 py-6 space-y-6">
        {/* ── Clients section ─────────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-base font-semibold text-white">Clients</h3>
                <p className="text-muted text-xs">Canonical external clients, identified by CRN</p>
              </div>
            </div>
            <button
              onClick={() => { setShowRegister(true); setRegName(''); setRegCrn(''); setRegError(''); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Register Client
            </button>
          </div>

          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or CRN..."
              className="w-full pl-9 pr-3 py-2 bg-zinc-900/60 border border-zinc-800/50 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/30 transition-colors"
            />
          </div>

          {/* Register form */}
          {showRegister && (
            <div className="max-w-md space-y-2 p-4 bg-zinc-900/60 border border-zinc-800/50 rounded-lg">
              <p className="text-sm font-medium text-zinc-200">Register a new client</p>
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Client name"
                className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
              {crnConfig?.autoGenerate ? (
                <p className="text-xs text-muted">A CRN will be generated automatically.</p>
              ) : (
                <input
                  type="text"
                  value={regCrn}
                  onChange={(e) => setRegCrn(e.target.value)}
                  placeholder={`CRN${crnConfig?.prefix ? ` (e.g. ${crnConfig.prefix}000123)` : ''}`}
                  className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                />
              )}
              {regError && <p className="text-xs text-red-400">{regError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleRegister}
                  disabled={regBusy}
                  className="px-3 py-1.5 text-sm rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
                >
                  {regBusy ? 'Saving…' : 'Register'}
                </button>
                <button
                  onClick={() => setShowRegister(false)}
                  className="px-3 py-1.5 text-sm rounded-lg bg-zinc-700/50 text-muted hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800/50 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">CRN</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-muted uppercase tracking-wider">Added By</th>
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
                ) : clients.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-muted text-sm">
                      {search ? 'No matching clients.' : 'No clients registered yet.'}
                    </td>
                  </tr>
                ) : (
                  clients.map(c => {
                    const editing = editingCrn === c.crn;
                    return (
                    <tr key={c.crn} className="border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-top">
                      <td className="px-4 py-3">
                        {editing ? (
                          <input
                            type="text"
                            value={editCrnValue}
                            onChange={(e) => setEditCrnValue(e.target.value)}
                            className="w-36 px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded text-cyan-400 font-mono text-sm focus:outline-none focus:border-cyan-500/50"
                            title="CRN"
                          />
                        ) : (
                          <span className="text-sm font-mono text-cyan-400">{c.crn}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editing ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="w-full px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50"
                              autoFocus
                              title="Name"
                            />
                            {editError && <p className="text-xs text-red-400">{editError}</p>}
                          </div>
                        ) : (
                          <span className="text-sm text-zinc-200">{c.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted">{c.createdByName || '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {editing ? (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleSave(c.crn)}
                              disabled={editBusy}
                              className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                              title="Save"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setEditingCrn(null)}
                              className="p-1.5 rounded text-muted hover:bg-zinc-700/50"
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(c)}
                            className="p-1.5 rounded text-muted hover:text-cyan-400 hover:bg-white/[0.05] transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Teams section ───────────────────────────────────────────────── */}
        <OrgSection
          title="Teams"
          singular="team"
          icon={<Users className="w-5 h-5 text-cyan-400" />}
          api={TEAM_API}
        />

        {/* ── Offices section ─────────────────────────────────────────────── */}
        <OrgSection
          title="Offices"
          singular="office"
          icon={<Building2 className="w-5 h-5 text-cyan-400" />}
          api={OFFICE_API}
        />
      </div>
    </>
  );
}
