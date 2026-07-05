'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, CheckCircle, XCircle, ShieldCheck, ShieldOff, RotateCcw, Clock, Trash2 } from 'lucide-react';
import { useCurrentUser } from '@/app/lib/auth/context';
import type { User } from '@/app/lib/auth/types';
import { Select } from '@/app/components/ui/Select';
import { getTitles } from '@/app/lib/api/titles';

function StatusBadge({ status }: { status: User['status'] }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Active
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
        <Clock className="w-3 h-3" />
        Pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-500/15 text-muted border border-zinc-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
      Inactive
    </span>
  );
}

function RoleBadge({ role }: { role: User['role'] }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/15 text-cyan-400 border border-cyan-500/20">
        <ShieldCheck className="w-3 h-3" />
        Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-800/60 text-muted border border-zinc-700/50">
      User
    </span>
  );
}

function ActionButton({
  onClick,
  disabled,
  title,
  variant,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant: 'approve' | 'deactivate' | 'reactivate' | 'makeAdmin' | 'removeAdmin' | 'delete';
  children: React.ReactNode;
}) {
  const styles = {
    approve: 'text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/20',
    deactivate: 'text-red-400 hover:bg-red-500/10 border-red-500/20',
    reactivate: 'text-cyan-400 hover:bg-cyan-500/10 border-cyan-500/20',
    makeAdmin: 'text-cyan-400 hover:bg-cyan-500/10 border-cyan-500/20',
    removeAdmin: 'text-muted hover:bg-zinc-500/10 border-zinc-500/20',
    delete: 'text-red-400 hover:bg-red-500/10 border-red-500/20',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export default function AdminUsersPage() {
  const { user: currentUser } = useCurrentUser();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);

  useEffect(() => {
    getTitles().then(items => setTitles(items.map(t => t.name))).catch(() => setTitles([]));
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) {
        setError('Failed to load users.');
        return;
      }
      setUsers(await res.json());
    } catch {
      setError('Unable to connect.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    const es = new EventSource('/api/admin/users/events');
    es.onmessage = (e) => {
      if (e.data !== 'connected') fetchUsers();
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [fetchUsers]);

  async function patch(id: string, body: Partial<Pick<User, 'status' | 'role' | 'title'>>) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        await fetchUsers();
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteUser(id: string, name: string) {
    if (!window.confirm(`Permanently delete the pending account for ${name}? This cannot be undone.`)) {
      return;
    }
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchUsers();
      }
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const isSelf = (id: string) => currentUser?.id === id;

  // Founding account = earliest createdAt; their admin can only be removed by themselves
  const founderId = users.length > 0
    ? users.reduce((a, b) => a.createdAt < b.createdAt ? a : b).id
    : null;
  const currentIsFounder = currentUser?.id === founderId;

  return (
    <div className="px-6 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-lg flex items-center justify-center">
            <Users className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-zinc-100">User Management</h1>
            <p className="text-sm text-muted">Manage team member accounts and permissions</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted text-sm">Loading...</div>
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/50">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Email</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Title</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Team</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Office</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Role</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/30">
              {users.map(u => {
                const self = isSelf(u.id);
                const busy = actionLoading === u.id;
                const isFounder = u.id === founderId;
                return (
                  <tr key={u.id} className="hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-semibold">
                          {u.firstName[0]}{u.lastName[0]}
                        </div>
                        <span className="text-zinc-200 font-medium">{u.firstName} {u.lastName}</span>
                        {self && <span className="text-xs text-muted">(you)</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.email}</td>
                    <td className="px-4 py-3">
                      {editingTitleId === u.id ? (
                        <div className="w-40">
                          <Select
                            value={u.title}
                            onValueChange={v => {
                              if (v !== u.title) patch(u.id, { title: v });
                              setEditingTitleId(null);
                            }}
                            options={titles}
                            placeholder="Select title"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditingTitleId(u.id)}
                          disabled={busy}
                          className="text-muted text-sm hover:text-zinc-200 transition-colors disabled:opacity-50"
                          title="Click to change title (promotion)"
                        >
                          {u.title || <span className="text-zinc-600">—</span>}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted">{u.team}</td>
                    <td className="px-4 py-3 text-muted">{u.office}</td>
                    <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                    <td className="px-4 py-3"><StatusBadge status={u.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {u.status === 'pending' && (
                          <>
                            <ActionButton
                              variant="approve"
                              onClick={() => patch(u.id, { status: 'active' })}
                              disabled={busy}
                            >
                              <CheckCircle className="w-3 h-3" />
                              Approve
                            </ActionButton>
                            <ActionButton
                              variant="delete"
                              onClick={() => deleteUser(u.id, `${u.firstName} ${u.lastName}`)}
                              disabled={busy}
                            >
                              <Trash2 className="w-3 h-3" />
                              Delete
                            </ActionButton>
                          </>
                        )}
                        {u.status === 'active' && (
                          <ActionButton
                            variant="deactivate"
                            onClick={() => patch(u.id, { status: 'inactive' })}
                            disabled={busy || self}
                            title={self ? 'Cannot deactivate your own account' : undefined}
                          >
                            <XCircle className="w-3 h-3" />
                            Deactivate
                          </ActionButton>
                        )}
                        {u.status === 'inactive' && (
                          <ActionButton
                            variant="reactivate"
                            onClick={() => patch(u.id, { status: 'active' })}
                            disabled={busy}
                          >
                            <RotateCcw className="w-3 h-3" />
                            Reactivate
                          </ActionButton>
                        )}
                        {u.role === 'user' && (
                          <ActionButton
                            variant="makeAdmin"
                            onClick={() => patch(u.id, { role: 'admin' })}
                            disabled={busy}
                          >
                            <ShieldCheck className="w-3 h-3" />
                            Make Admin
                          </ActionButton>
                        )}
                        {u.role === 'admin' && (
                          <ActionButton
                            variant="removeAdmin"
                            onClick={() => patch(u.id, { role: 'user' })}
                            disabled={busy || (isFounder && !currentIsFounder) || (self && !isFounder)}
                            title={
                              isFounder && !currentIsFounder
                                ? 'Only the account holder can remove their own admin privileges'
                                : self ? 'Cannot remove admin from your own account'
                                : undefined
                            }
                          >
                            <ShieldOff className="w-3 h-3" />
                            Remove Admin
                          </ActionButton>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">{formatDate(u.createdAt)}</td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
