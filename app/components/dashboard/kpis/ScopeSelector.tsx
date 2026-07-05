'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Select } from '@/app/components/ui/Select';
import { useCurrentUser } from '@/app/lib/auth/context';
import { getTeams } from '@/app/lib/api/org';
import type { KpiScope } from '@/app/lib/api/kpi';

interface ScopeSelectorProps {
  value: KpiScope;
  onChange: (scope: KpiScope) => void;
}

const ALL_OPTION = { value: 'all' as const, label: 'All Teams' };

export default function ScopeSelector({ value, onChange }: ScopeSelectorProps) {
  const { user } = useCurrentUser();

  // Admins can scope to any managed team; the list reflects the live Teams
  // registry (in the admin-set order). Non-admins fall back to their own team.
  const [teams, setTeams] = useState<string[]>([]);
  useEffect(() => {
    getTeams().then(items => setTeams(items.map(t => t.name))).catch(() => setTeams([]));
  }, []);

  // Non-admins may only scope to 'all' or to their own team; admins see every
  // team. This mirrors the server-side enforcement in canAccessKpiScope.
  const options = useMemo(() => {
    if (!user) return [ALL_OPTION];
    if (user.role === 'admin') {
      return [ALL_OPTION, ...teams.map(t => ({ value: `team:${t}`, label: t }))];
    }
    return user.team
      ? [ALL_OPTION, { value: `team:${user.team}`, label: user.team }]
      : [ALL_OPTION];
  }, [user, teams]);

  const currentLabel = options.find(o => o.value === value)?.label ?? 'All Teams';

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as KpiScope)}
      options={options}
      matchTriggerWidth={false}
      triggerClassName="flex items-center gap-1.5 px-3 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-medium hover:from-blue-500 hover:to-cyan-400 transition-all focus:outline-none"
      triggerIcon={<Users className="w-4 h-4" />}
      triggerLabel={currentLabel}
    />
  );
}
