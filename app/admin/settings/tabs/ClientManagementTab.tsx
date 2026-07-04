'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Building2, Search, Plus, Pencil, Check, X, Loader2, AlertTriangle } from 'lucide-react';
import {
  getClients, registerClient, updateClient, getCrnConfig,
  CrnConfigResponse, ClientConflictError,
} from '@/app/lib/api/client-interactions';
import type { Client } from '@/app/lib/types/engagements';

/** Client Management tab — the canonical external-client registry (identified by CRN). */
export default function ClientManagementTab() {
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
    getCrnConfig().then(setCrnConfig).catch(() => setCrnConfig({ autoGenerate: false, prefix: '' }));
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => load(search), 200);
    return () => clearTimeout(handle);
  }, [search, load]);

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
      setClients(prev => prev.map(c => (c.crn === currentCrn ? { crn: updated.crn, name: updated.name, createdByName: c.createdByName, crnPending: updated.crnPending ?? false } : c)));
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

  return (
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
                <tr key={c.crn} className="border-b border-zinc-800/30 hover:bg-white/[0.02] transition-colors align-middle">
                  <td className="px-4 py-3">
                    {editing ? (
                      <input
                        type="text"
                        value={editCrnValue}
                        onChange={(e) => setEditCrnValue(e.target.value)}
                        className="w-36 px-2 py-1 bg-zinc-800/50 border border-zinc-700 rounded text-cyan-400 font-mono text-sm focus:outline-none focus:border-cyan-500/50"
                        title="CRN"
                      />
                    ) : c.crnPending ? (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-red-500/15 text-red-400 border border-red-500/30"
                        title="No CRN yet — edit this client to set the real CRN."
                      >
                        <AlertTriangle className="w-3 h-3" />
                        CRN Pending
                      </span>
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
  );
}
