'use client';

import React from 'react';
import { Users, Building2 } from 'lucide-react';
import {
  getTeams, createTeam, renameTeam, deleteTeam,
  getOffices, createOffice, renameOffice, deleteOffice,
} from '@/app/lib/api/org';
import { OrgSection } from '@/app/admin/settings/_components/OrgSection';
import TeamMembersManager from '@/app/admin/settings/_components/TeamMembersManager';

// Stable, module-level API bundles so <OrgSection>'s effects don't re-run each render.
const TEAM_API = { list: getTeams, create: createTeam, rename: renameTeam, remove: deleteTeam };
const OFFICE_API = { list: getOffices, create: createOffice, rename: renameOffice, remove: deleteOffice };

/** Team & Office tab — Teams, Offices, and the Team Members roster. */
export default function TeamOfficeTab() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <OrgSection
          title="Teams"
          singular="team"
          icon={<Users className="w-5 h-5 text-cyan-400" />}
          api={TEAM_API}
        />
        <OrgSection
          title="Offices"
          singular="office"
          icon={<Building2 className="w-5 h-5 text-cyan-400" />}
          api={OFFICE_API}
          align="right"
        />
      </div>
      <TeamMembersManager />
    </div>
  );
}
