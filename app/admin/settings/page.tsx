'use client';

import React, { Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Settings, Building2, Users, Contact, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/app/lib/auth/context';
import { TabBar, type TabDef } from '@/app/components/ui/Tabs';
import ClientManagementTab from '@/app/admin/settings/tabs/ClientManagementTab';
import TeamOfficeTab from '@/app/admin/settings/tabs/TeamOfficeTab';
import InternalClientsTab from '@/app/admin/settings/tabs/InternalClientsTab';

type TabKey = 'client' | 'team-office' | 'internal-clients';

const TABS: TabDef<TabKey>[] = [
  { key: 'team-office', label: 'Team & Office', icon: <Users className="w-4 h-4" /> },
  { key: 'internal-clients', label: 'Internal Clients', icon: <Contact className="w-4 h-4" /> },
  { key: 'client', label: 'Client Management', icon: <Building2 className="w-4 h-4" /> },
];

const TAB_KEYS = new Set<TabKey>(['client', 'team-office', 'internal-clients']);

/** Sticky page header. `right` renders across from the title (e.g. the tab bar). */
function SettingsHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex-shrink-0 bg-transparent backdrop-blur-md border-b border-zinc-800/50 relative z-50 sticky top-0">
      <div className="px-6 pt-6 pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Settings className="w-6 h-6 text-cyan-400" />
            <div>
              <h2 className="text-xl font-semibold text-white">Settings</h2>
              <p className="text-muted text-sm">Administer the workspace</p>
            </div>
          </div>
          {right}
        </div>
      </div>
    </header>
  );
}

function SettingsTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('tab');
  const active: TabKey = raw && TAB_KEYS.has(raw as TabKey) ? (raw as TabKey) : 'team-office';

  const setActive = useCallback((key: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', key);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  return (
    <>
      <SettingsHeader right={<TabBar tabs={TABS} active={active} onChange={setActive} />} />
      <div className="px-6 py-6">
        {active === 'client' && <ClientManagementTab />}
        {active === 'team-office' && <TeamOfficeTab />}
        {active === 'internal-clients' && <InternalClientsTab />}
      </div>
    </>
  );
}

export default function SettingsPage() {
  const { user, isLoading: userLoading } = useCurrentUser();
  const isAdmin = user?.role === 'admin';

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
    <Suspense fallback={<SettingsHeader />}>
      <SettingsTabs />
    </Suspense>
  );
}
