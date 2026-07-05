'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus, LinkIcon, X, AlertCircle } from 'lucide-react';
import type { TeamMember, User } from '@/app/lib/auth/types';
import { Select } from '@/app/components/ui/Select';
import { getTeams, getOffices } from '@/app/lib/api/org';
import { getTitles } from '@/app/lib/api/titles';
import { useRowFlashes, FLASH_CLASS, FLASH_TEXT_CLASS, type FieldSpec } from '@/app/lib/hooks/useRowFlashes';
import { useSettingsStream } from '@/app/lib/hooks/useSettingsStream';

interface TeamMemberWithLinked extends TeamMember {
  linkedEmail: string | null;
  linkedName: string | null;
}

// A registry rename cascades into team/office/title on members, and roster/user
// edits change links — refetch on any of them.
const ROSTER_LIVE = ['team', 'office', 'title', 'team_member', 'user'];
const ROSTER_FLASH_SPECS: FieldSpec<TeamMemberWithLinked>[] = [
  { key: 'name', get: r => `${r.firstName} ${r.lastName}` },
  { key: 'title', get: r => r.title },
  { key: 'office', get: r => r.office },
  { key: 'status', get: r => r.status },
  { key: 'linked', get: r => r.linkedEmail ?? '' },
];

function StatusBadge({ status }: { status: TeamMember['status'] }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        Active
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

function ActionButton({
  onClick,
  disabled,
  variant,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant: 'unlink' | 'deactivate' | 'reactivate';
  children: React.ReactNode;
  title?: string;
}) {
  const styles = {
    unlink: 'text-muted hover:bg-zinc-500/10 border-zinc-500/20',
    deactivate: 'text-red-400 hover:bg-red-500/10 border-red-500/20',
    reactivate: 'text-cyan-400 hover:bg-cyan-500/10 border-cyan-500/20',
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

interface AddModalProps {
  teams: string[];
  offices: string[];
  titles: string[];
  onClose: () => void;
  onAdded: () => void;
}

function AddModal({ teams, offices, titles, onClose, onAdded }: AddModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [team, setTeam] = useState<string>(teams[0] ?? '');
  const [office, setOffice] = useState<string>(offices[0] ?? '');
  const [title, setTitle] = useState<string>(titles[0] ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/team-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), title, team, office }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to add team member.');
        return;
      }
      onAdded();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-100">Add Team Member</h2>
          <button onClick={onClose} className="text-muted hover:text-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">First Name</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-zinc-800/50 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-zinc-800/50 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Title</label>
            <Select
              value={title}
              onValueChange={setTitle}
              options={titles}
              placeholder="Select title"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Team</label>
            <Select
              value={team}
              onValueChange={setTeam}
              options={teams}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Office</label>
            <Select
              value={office}
              onValueChange={setOffice}
              options={offices}
            />
          </div>
          {firstName && lastName && (
            <p className="text-xs text-muted">
              Will appear in the form as: <span className="text-cyan-400 font-medium">{firstName.trim()} {lastName.trim()[0]}.</span>
            </p>
          )}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-muted hover:text-zinc-200 transition-colors">Cancel</button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface LinkModalProps {
  member: TeamMemberWithLinked;
  users: User[];
  onClose: () => void;
  onLinked: () => void;
}

function LinkModal({ member, users, onClose, onLinked }: LinkModalProps) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Filter: active users on the same team not already linked elsewhere
  const eligible = users.filter(u => u.status === 'active' && u.team === member.team);

  async function handleLink() {
    if (!selectedUserId) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/team-members/${member.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to link user.');
        return;
      }
      onLinked();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-100">Link User Account</h2>
          <button onClick={onClose} className="text-muted hover:text-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-muted">
            Linking a user account to <span className="text-cyan-400 font-medium">{member.displayName}</span> will associate all past and future engagements with their profile.
          </p>
          {eligible.length === 0 ? (
            <p className="text-xs text-muted">No eligible active users found on the {member.team} team.</p>
          ) : (
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Select user account</label>
              <Select
                value={selectedUserId}
                onValueChange={setSelectedUserId}
                options={eligible.map(u => ({ value: u.id, label: `${u.firstName} ${u.lastName} (${u.email})` }))}
                placeholder="— Select —"
              />
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-muted hover:text-zinc-200 transition-colors">Cancel</button>
            <button
              onClick={handleLink}
              disabled={loading || !selectedUserId}
              className="px-4 py-1.5 text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Linking...' : 'Link Account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Team Members roster manager — the standalone /admin/team-members page, folded
 *  into the Team & Office settings tab. */
export default function TeamMembersManager() {
  const [members, setMembers] = useState<TeamMemberWithLinked[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [linkingMember, setLinkingMember] = useState<TeamMemberWithLinked | null>(null);
  const [editingOfficeId, setEditingOfficeId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [teams, setTeams] = useState<string[]>([]);
  const [offices, setOffices] = useState<string[]>([]);
  const [titles, setTitles] = useState<string[]>([]);

  useEffect(() => {
    getTeams().then(items => setTeams(items.map(t => t.name))).catch(() => setTeams([]));
    getOffices().then(items => setOffices(items.map(o => o.name))).catch(() => setOffices([]));
    getTitles().then(items => setTitles(items.map(t => t.name))).catch(() => setTitles([]));
  }, []);

  const flashes = useRowFlashes(members, ROSTER_FLASH_SPECS);
  const cellFlash = (id: string, key: string) => {
    const t = flashes.cells.get(id)?.[key];
    return t ? FLASH_TEXT_CLASS[t.kind] : '';
  };
  const rowFlash = (id: string) => (flashes.newIds.has(id) ? FLASH_CLASS.neutral : '');

  const fetchAll = useCallback(async () => {
    try {
      const [membersRes, usersRes] = await Promise.all([
        fetch('/api/admin/team-members'),
        fetch('/api/admin/users'),
      ]);
      if (!membersRes.ok || !usersRes.ok) {
        setError('Failed to load data.');
        return;
      }
      setMembers(await membersRes.json());
      setUsers(await usersRes.json());
    } catch {
      setError('Unable to connect.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Silent refetch (no loading flicker) for live updates and post-mutation, so
  // the changed cells flash instead of the whole table blinking.
  const refetch = useCallback(async () => {
    try {
      const [membersRes, usersRes] = await Promise.all([
        fetch('/api/admin/team-members'),
        fetch('/api/admin/users'),
      ]);
      if (membersRes.ok) setMembers(await membersRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
    } catch {
      /* transient — keep showing current data */
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onStream = useCallback((entity: string) => {
    if (ROSTER_LIVE.includes(entity)) refetch();
  }, [refetch]);
  useSettingsStream(onStream);

  async function patch(id: string, body: Record<string, unknown>) {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/admin/team-members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) await refetch();
    } finally {
      setActionLoading(null);
    }
  }

  // Group members by team for display
  const byTeam = members.reduce((acc, m) => {
    if (!acc[m.team]) acc[m.team] = [];
    acc[m.team].push(m);
    return acc;
  }, {} as Record<string, TeamMemberWithLinked[]>);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-base font-semibold text-white">Team Members</h3>
            <p className="text-muted text-xs">The roster that appears in the New Interaction form</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-l from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          Add Member
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-48 text-muted text-sm">Loading...</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byTeam).map(([team, teamMembers]) => (
            <div key={team}>
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider mb-2">{team}</h4>
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/50">
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Name</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Display</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Title</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Office</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Linked Account</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/30">
                    {teamMembers.map(m => {
                      const busy = actionLoading === m.id;
                      return (
                        <tr key={m.id} className={`hover:bg-zinc-800/20 transition-colors align-middle ${rowFlash(m.id)}`}>
                          <td className="px-4 py-3 text-zinc-200 font-medium"><span className={cellFlash(m.id, 'name')}>{m.firstName} {m.lastName}</span></td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs px-1.5 py-0.5 bg-zinc-800 rounded text-cyan-400">{m.displayName}</span>
                          </td>
                          <td className="px-4 py-3">
                            {editingTitleId === m.id ? (
                              <div className="w-40">
                                <Select
                                  value={m.title}
                                  onValueChange={v => {
                                    patch(m.id, { title: v });
                                    setEditingTitleId(null);
                                  }}
                                  options={titles}
                                  placeholder="Select title"
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditingTitleId(m.id)}
                                className={`text-left text-muted text-sm hover:text-zinc-200 transition-colors ${cellFlash(m.id, 'title')}`}
                                title="Click to edit title"
                              >
                                {m.title || <span className="text-zinc-600">—</span>}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {editingOfficeId === m.id ? (
                              <div className="w-36">
                                <Select
                                  value={m.office}
                                  onValueChange={v => {
                                    patch(m.id, { office: v });
                                    setEditingOfficeId(null);
                                  }}
                                  options={offices}
                                />
                              </div>
                            ) : (
                              <button
                                onClick={() => setEditingOfficeId(m.id)}
                                className={`text-muted text-sm hover:text-zinc-200 transition-colors ${cellFlash(m.id, 'office')}`}
                                title="Click to edit office"
                              >
                                {m.office}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3"><span className={`inline-flex ${cellFlash(m.id, 'status')}`}><StatusBadge status={m.status} /></span></td>
                          <td className="px-4 py-3">
                            {m.linkedEmail ? (
                              <div className={`flex items-center gap-1.5 ${cellFlash(m.id, 'linked')}`}>
                                <LinkIcon className="w-3 h-3 text-emerald-400" />
                                <span className="text-muted text-xs">{m.linkedName}</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => setLinkingMember(m)}
                                className="text-muted text-xs hover:text-cyan-400 border-b border-dashed border-zinc-700 hover:border-cyan-500/50 transition-colors"
                              >
                                Unlinked
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {m.linkedEmail && (
                                <ActionButton
                                  variant="unlink"
                                  onClick={() => patch(m.id, { userId: null })}
                                  disabled={busy}
                                  title="Remove the link to this user account"
                                >
                                  <X className="w-3 h-3" />
                                  Unlink
                                </ActionButton>
                              )}
                              {m.status === 'active' && (
                                <ActionButton
                                  variant="deactivate"
                                  onClick={() => patch(m.id, { status: 'inactive' })}
                                  disabled={busy}
                                  title="Remove from the New Interaction form"
                                >
                                  Remove
                                </ActionButton>
                              )}
                              {m.status === 'inactive' && (
                                <ActionButton
                                  variant="reactivate"
                                  onClick={() => patch(m.id, { status: 'active' })}
                                  disabled={busy}
                                >
                                  Restore
                                </ActionButton>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {teamMembers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-muted text-xs">No members yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {members.length === 0 && (
            <div className="text-center py-16 text-muted text-sm">
              No team members added yet. Click &ldquo;Add Member&rdquo; to get started.
            </div>
          )}
        </div>
      )}

      {showAddModal && (
        <AddModal teams={teams} offices={offices} titles={titles} onClose={() => setShowAddModal(false)} onAdded={refetch} />
      )}
      {linkingMember && (
        <LinkModal
          member={linkingMember}
          users={users}
          onClose={() => setLinkingMember(null)}
          onLinked={refetch}
        />
      )}
    </section>
  );
}
