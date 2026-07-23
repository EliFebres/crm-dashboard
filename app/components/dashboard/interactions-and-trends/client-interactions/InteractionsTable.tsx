'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { FileText, Download, Check, X, ChevronUp, ChevronDown, ChevronsUpDown, Maximize2, Minimize2, Plus, Loader2, Link2, AlertTriangle, UserPlus } from 'lucide-react';
import NotesModal from '@/app/components/dashboard/interactions-and-trends/client-interactions/NotesModal';
import NNAModal from '@/app/components/dashboard/interactions-and-trends/client-interactions/NNAModal';
import { Select } from '@/app/components/ui/Select';
import type { Engagement } from '@/app/lib/types/engagements';
import type { SortSpec } from '@/app/lib/api/client-interactions';
import type { ChangeFlash, EngagementField } from '@/app/lib/hooks/useDashboardChanges';
import { FLASH_CLASS, FLASH_TEXT_CLASS } from '@/app/lib/hooks/useDashboardChanges';
import { VALID_STATUSES } from '@/app/lib/statusHelpers';
import { canUserEditEngagement, isReadOnlyUser, toDisplayName, type User } from '@/app/lib/auth/types';
import { getIntakeTypes, getProjectTypes } from '@/app/lib/api/types';

type SortColumn =
  | 'externalClient'
  | 'internalClient'
  | 'intakeType'
  | 'type'
  | 'teamMembers'
  | 'dateStarted'
  | 'dateFinished'
  | 'portfolioLogged'
  | 'nna'
  | 'status';

// Sortable column header component
interface SortableHeaderProps {
  label: string;
  column: SortColumn;
  // The column's entry in the sortBy array (if any) and its 0-based position.
  active?: { direction: 'asc' | 'desc'; index: number };
  // Total number of columns currently being sorted — used to decide whether to
  // show a priority badge next to the arrow.
  totalActive: number;
  onSort: (column: SortColumn, shift: boolean) => void;
  centered?: boolean;
}

const SortableHeader: React.FC<SortableHeaderProps> = ({ label, column, active, totalActive, onSort, centered }) => {
  return (
    <th
      onClick={(e) => onSort(column, e.shiftKey)}
      title="Click to sort. Shift+click to add a secondary sort."
      className={`${centered ? 'text-center' : 'text-left'} text-xs font-medium text-muted uppercase tracking-wider px-4 py-3 cursor-pointer hover:text-zinc-200 transition-colors select-none group`}
    >
      <div className={`flex items-center gap-1 ${centered ? 'justify-center' : ''}`}>
        {label}
        <span className="inline-flex items-center gap-0.5">
          {active ? (
            active.direction === 'asc' ? (
              <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
            )
          ) : (
            <ChevronsUpDown className="w-3.5 h-3.5 text-muted group-hover:text-muted transition-colors" />
          )}
          {active && totalActive > 1 && (
            <span className="text-[9px] font-bold text-cyan-400 leading-none">{active.index + 1}</span>
          )}
        </span>
      </div>
    </th>
  );
};

interface InteractionsTableProps {
  engagements: Engagement[];
  sortBy: SortSpec[];
  onSort: (column: string, shift: boolean) => void;
  onStatusChange: (engagementId: number, newStatus: string) => void;
  onNoteAdded: (engagementId: number) => void;
  onNoteDeleted: (engagementId: number) => void;
  onFilepathSaved: (engagementId: number, filepath: string | null) => void;
  onNNAChange: (engagementId: number, nna: number | undefined) => void;
  /** Claim an unassigned engagement for the current user. */
  onAssignSelf: (engagementId: number) => void;
  onRowClick: (engagement: Engagement) => void;
  onExport: () => void;
  isExporting?: boolean;
  newRowIds?: Map<number, ChangeFlash>;
  removedRowIds?: Map<number, ChangeFlash>;
  rowFieldChanges?: Map<number, Partial<Record<EngagementField, ChangeFlash>>>;
  readOnly?: boolean;
  currentUser?: User | null;
}

interface GhostRow {
  engagement: Engagement;
  expiresAt: number;
}

const InteractionsTable: React.FC<InteractionsTableProps> = ({ engagements, sortBy, onSort, onStatusChange, onNoteAdded, onNoteDeleted, onFilepathSaved, onNNAChange, onAssignSelf, onRowClick, onExport, isExporting, newRowIds, removedRowIds, rowFieldChanges, readOnly = false, currentUser }) => {
  // O(1) lookup from column name → its position in sortBy + direction.
  const sortIndex = useMemo(() => {
    const map = new Map<string, { direction: 'asc' | 'desc'; index: number }>();
    sortBy.forEach((s, i) => map.set(s.column, { direction: s.direction, index: i }));
    return map;
  }, [sortBy]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notesModalEngagement, setNotesModalEngagement] = useState<Engagement | null>(null);
  const [nnaModalEngagement, setNnaModalEngagement] = useState<Engagement | null>(null);
  // Live intake/project-type chart colors from the managed registries, so a badge
  // reflects the color set in Settings (and keeps working after a type is renamed).
  const [intakeColors, setIntakeColors] = useState<Record<string, string>>({});
  const [projectColors, setProjectColors] = useState<Record<string, string>>({});
  useEffect(() => {
    getIntakeTypes()
      .then(items => setIntakeColors(Object.fromEntries(items.map(t => [t.name, t.color]))))
      .catch(() => setIntakeColors({}));
    getProjectTypes()
      .then(items => setProjectColors(Object.fromEntries(items.map(t => [t.name, t.color]))))
      .catch(() => setProjectColors({}));
  }, []);
  const pageSize = 10;

  // Ghost-row tracking: keep just-removed rows around briefly so they can fade out red.
  const [ghostRows, setGhostRows] = useState<GhostRow[]>([]);
  const prevEngagementsRef = useRef<Map<number, Engagement>>(new Map());

  useEffect(() => {
    // Read prev map before updating it so we can still find the removed rows' data.
    if (removedRowIds && removedRowIds.size > 0) {
      const prevMap = prevEngagementsRef.current;
      setGhostRows(current => {
        const existingIds = new Set(current.map(g => g.engagement.id));
        const toAdd: GhostRow[] = [];
        const expiresAt = Date.now() + 1100;
        for (const id of removedRowIds.keys()) {
          if (existingIds.has(id)) continue;
          const e = prevMap.get(id);
          if (e) toAdd.push({ engagement: e, expiresAt });
        }
        return toAdd.length > 0 ? [...current, ...toAdd] : current;
      });
    }
    // Update prev snapshot to the current engagements.
    const next = new Map<number, Engagement>();
    for (const e of engagements) next.set(e.id, e);
    prevEngagementsRef.current = next;
  }, [engagements, removedRowIds]);

  useEffect(() => {
    if (ghostRows.length === 0) return;
    const soonest = Math.min(...ghostRows.map(g => g.expiresAt));
    const delay = Math.max(10, soonest - Date.now() + 20);
    const timer = setTimeout(() => {
      const now = Date.now();
      setGhostRows(cur => cur.filter(g => g.expiresAt > now));
    }, delay);
    return () => clearTimeout(timer);
  }, [ghostRows]);

  const statusOptions = [...VALID_STATUSES];

  // Reset to page 1 when data or sort changes. Adjust state during render
  // rather than in an effect — React discards the in-progress render and
  // restarts with the new state, so there's no extra commit.
  const resetKey = `${engagements.length}|${sortBy.map(s => `${s.column}:${s.direction}`).join(',')}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setCurrentPage(1);
  }

  // Pagination calculations — engagements already arrive sorted from server
  const totalPages = Math.ceil(engagements.length / pageSize);
  const paginatedEngagements = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return engagements.slice(startIndex, startIndex + pageSize);
  }, [engagements, currentPage]);

  // Generate page numbers to display
  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, 'ellipsis', totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, 'ellipsis', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, 'ellipsis', currentPage - 1, currentPage, currentPage + 1, 'ellipsis', totalPages);
      }
    }
    return pages;
  };

  // Shared palette so same-colored badges render identically across columns.
  const BADGE_COLORS = {
    blue:    'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    amber:   'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    orange:  'bg-orange-500/15 text-orange-400 border border-orange-500/30',
    cyan:    'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
    violet:  'bg-violet-500/15 text-violet-400 border border-violet-500/30',
    rose:    'bg-rose-500/15 text-rose-400 border border-rose-500/30',
    pink:    'bg-pink-500/15 text-pink-400 border border-pink-500/30',
    zinc:    'bg-zinc-500/15 text-muted border border-zinc-500/30',
  } as const;

  // Style helpers
  const getStatusStyle = (status: string): string => {
    switch (status) {
      case 'Completed': return BADGE_COLORS.emerald;
      case 'In Progress': return BADGE_COLORS.blue;
      case 'Awaiting Meeting': return BADGE_COLORS.amber;
      case 'Follow Up': return BADGE_COLORS.orange;
      default: return BADGE_COLORS.zinc;
    }
  };

  const getTypeStyle = (type: string): string => {
    switch (type) {
      case 'Data Request': return BADGE_COLORS.cyan;
      case 'Data Update': return BADGE_COLORS.orange;
      case 'Meeting': return BADGE_COLORS.violet;
      case 'Discovery Meeting': return BADGE_COLORS.blue;
      case 'PCR': return BADGE_COLORS.rose;
      case 'Follow-up Material': return BADGE_COLORS.amber;
      case 'Follow-up Meeting': return BADGE_COLORS.emerald;
      case 'Other': return BADGE_COLORS.zinc;
      default: return BADGE_COLORS.zinc;
    }
  };

  const getIntakeTypeStyle = (intakeType: string): string => {
    switch (intakeType) {
      case 'IRQ': return BADGE_COLORS.blue;
      case 'SERF': return BADGE_COLORS.emerald;
      case 'Ad-Hoc': return BADGE_COLORS.pink;
      default: return BADGE_COLORS.zinc;
    }
  };

  // Inline badge styling from a managed hex color — mirrors the BADGE_COLORS look
  // (~15% bg tint, solid text, ~30% border) but for any admin-chosen color. The
  // 8-digit-hex alpha suffixes (26 ≈ 15%, 4d ≈ 30%) match the Tailwind /15 and /30.
  const managedBadgeStyle = (hex?: string): React.CSSProperties | undefined =>
    hex ? { color: hex, backgroundColor: `${hex}26`, borderColor: `${hex}4d`, borderWidth: 1, borderStyle: 'solid' } : undefined;

  const getInitials = (name: string): string => {
    return name.split(' ').map(n => n[0]).join('');
  };

  const formatTableNNA = (value: number | undefined): string => {
    if (!value || value === 0) return '—';
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(1)}B`;
    } else if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(0)}M`;
    } else if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  // Build a per-cell flash className based on the rowFieldChanges map for this id.
  const flashFor = (id: number, field: EngagementField): string => {
    const flash = rowFieldChanges?.get(id)?.[field];
    return flash ? FLASH_CLASS[flash.kind] : '';
  };
  // Text-color variant: recolors the text inside an element instead of painting a box behind it.
  const flashTextFor = (id: number, field: EngagementField): string => {
    const flash = rowFieldChanges?.get(id)?.[field];
    return flash ? FLASH_TEXT_CLASS[flash.kind] : '';
  };

  // Render table row
  const renderTableRow = (engagement: Engagement, keyPrefix: string = '', isGhost: boolean = false) => {
    const rowFlash = !isGhost && newRowIds?.has(engagement.id) ? FLASH_CLASS[newRowIds.get(engagement.id)!.kind] : '';
    const ghostClass = isGhost ? 'ghost-row' : '';
    const canEdit = !readOnly && canUserEditEngagement(currentUser, engagement.teamMembers);
    // Claiming needs a real user to attribute the assignment to; read-only teams can't.
    const canClaim = !readOnly && !!currentUser && !isReadOnlyUser(currentUser);
    // Display name of the signed-in user, so their own avatar in the roster can be
    // highlighted with the site's cyan accent.
    const currentUserName = currentUser ? toDisplayName(currentUser.firstName, currentUser.lastName) : null;
    return (
    <tr
      key={`${keyPrefix}${isGhost ? 'ghost-' : ''}${engagement.id}`}
      className={`hover:bg-white/[0.02] transition-colors ${canEdit ? 'cursor-pointer' : ''} ${rowFlash} ${ghostClass}`.trim()}
      onClick={isGhost || !canEdit ? undefined : () => onRowClick(engagement)}
    >
      <td className="px-4 py-3">
        <div>
          <span className={`block text-sm font-medium ${engagement.externalClient ? 'text-zinc-200' : 'text-muted'}`}>
            {engagement.externalClient || '—'}
          </span>
          {engagement.crnPending ? (
            <span
              className="mt-1 flex w-fit items-center gap-0.5 px-1 py-px text-[8px] font-semibold uppercase tracking-wide rounded bg-red-500/15 text-red-400 border border-red-500/30"
              title="This client has no CRN yet. Open the interaction to add the real CRN."
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              CRN Pending
            </span>
          ) : (
            engagement.clientCrn && <p className="block text-xs text-muted">{engagement.clientCrn}</p>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div>
          <span className="text-sm font-medium text-zinc-200">{engagement.internalClient.name}</span>
          <p className="text-xs text-muted">{engagement.internalClient.clientDept}</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex px-2 py-0.5 text-xs font-medium backdrop-blur-sm ${intakeColors[engagement.intakeType] ? '' : getIntakeTypeStyle(engagement.intakeType)} ${flashTextFor(engagement.id, 'intakeType')}`}
          style={managedBadgeStyle(intakeColors[engagement.intakeType])}
        >
          {engagement.intakeType}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="inline-flex items-center gap-1.5">
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium backdrop-blur-sm ${projectColors[engagement.type] ? '' : getTypeStyle(engagement.type)} ${flashTextFor(engagement.id, 'type')}`}
            style={managedBadgeStyle(projectColors[engagement.type])}
          >
            {engagement.type}
          </span>
          {engagement.linkedFromId ? (
            <span
              title={`Linked from interaction #${engagement.linkedFromId}`}
              className="inline-flex"
              aria-label={`Linked from interaction #${engagement.linkedFromId}`}
            >
              <Link2 className="w-3 h-3 text-cyan-400/80" />
            </span>
          ) : null}
        </div>
      </td>
      <td className={`px-4 py-3 ${flashFor(engagement.id, 'teamMembers')}`}>
        {engagement.teamMembers.length === 0 ? (
          // Unassigned: anyone who can see the row may claim it. Ghost rows are a
          // fading copy of a deleted engagement, so they stay inert.
          canClaim && !isGhost ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAssignSelf(engagement.id); }}
              className="group inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-yellow-400/15 border border-yellow-400/50 text-yellow-300 hover:bg-cyan-500/20 hover:border-cyan-500/50 hover:text-cyan-300 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer"
              title="No team member is assigned — click to assign yourself"
            >
              <AlertTriangle className="w-3 h-3 group-hover:hidden" />
              <UserPlus className="w-3 h-3 hidden group-hover:block" />
              <span className="group-hover:hidden">Unassigned</span>
              <span className="hidden group-hover:inline">Assign to me</span>
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-yellow-400/15 border border-yellow-400/50 text-yellow-300 text-xs font-semibold whitespace-nowrap"
              title="No team member is assigned to this project"
            >
              <AlertTriangle className="w-3 h-3" />
              Unassigned
            </span>
          )
        ) : (
        <div className="flex -space-x-1.5">
          {engagement.teamMembers.slice(0, 4).map((member, idx) => {
            const isMe = member === currentUserName;
            return (
            <div
              key={idx}
              className={`w-7 h-7 backdrop-blur-sm border-2 flex items-center justify-center text-xs font-medium ${
                isMe
                  // z-10 lifts the highlighted avatar above its overlapping neighbours
                  // so the full cyan ring stays visible.
                  ? 'relative z-10 bg-cyan-400/15 border-cyan-400/40 text-cyan-300'
                  : 'bg-zinc-700/80 border-zinc-900/50 text-muted'
              }`}
              title={isMe ? `${member} (you)` : member}
            >
              {getInitials(member)}
            </div>
            );
          })}
          {engagement.teamMembers.length > 4 && (
            <div
              className="w-7 h-7 bg-zinc-600/80 backdrop-blur-sm border-2 border-zinc-900/50 flex items-center justify-center text-muted text-xs font-medium"
              title={engagement.teamMembers.slice(4).join(', ')}
            >
              +{engagement.teamMembers.length - 4}
            </div>
          )}
        </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-muted font-mono">{engagement.dateStarted}</span>
      </td>
      <td className="px-4 py-3">
        <span className={`text-sm font-mono ${engagement.dateFinished === '—' ? 'text-muted' : 'text-muted'} ${flashTextFor(engagement.id, 'dateFinished')}`}>
          {engagement.dateFinished}
        </span>
      </td>
      <td className="px-4 py-3">
        {engagement.portfolioLogged ? (
          <div className={`flex items-center gap-1.5 text-emerald-400 ${flashTextFor(engagement.id, 'portfolioLogged')}`}>
            <Check className="w-4 h-4" />
            <span className="text-xs font-medium">Yes</span>
          </div>
        ) : engagement.portfolioUnchanged ? (
          <div className={`flex items-center gap-1.5 text-sky-400 ${flashTextFor(engagement.id, 'portfolioUnchanged')}`} title="Model carried over unchanged from a prior interaction">
            <Check className="w-4 h-4" />
            <span className="text-xs font-medium">Unchanged</span>
          </div>
        ) : (
          <div className={`flex items-center gap-1.5 text-muted ${flashTextFor(engagement.id, 'portfolioLogged')}`}>
            <X className="w-4 h-4" />
            <span className="text-xs font-medium">No</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {!canEdit ? (
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 text-sm font-mono ${
              engagement.nna ? 'text-emerald-400' : 'text-muted'
            } ${flashTextFor(engagement.id, 'nna')}`}
          >
            {engagement.nna ? formatTableNNA(engagement.nna) : '—'}
          </span>
        ) : (
          <button
            onClick={() => setNnaModalEngagement(engagement)}
            className={`inline-flex items-center gap-1.5 px-2 py-1 text-sm font-mono transition-colors ${
              engagement.nna
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-muted hover:text-muted hover:bg-zinc-700/30'
            } ${flashTextFor(engagement.id, 'nna')}`}
            title={engagement.nna ? 'Edit NNA' : 'Add NNA'}
          >
            {engagement.nna ? (
              formatTableNNA(engagement.nna)
            ) : (
              <>
                <Plus className="w-3 h-3" />
                <span className="text-xs">Add</span>
              </>
            )}
          </button>
        )}
      </td>
      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
        {!canEdit ? (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium backdrop-blur-sm ${getStatusStyle(engagement.status)} ${flashTextFor(engagement.id, 'status')}`}
          >
            {engagement.status}
          </span>
        ) : (
          <Select
            value={engagement.status}
            onValueChange={(next) => onStatusChange(engagement.id, next)}
            options={statusOptions}
            matchTriggerWidth={false}
            triggerClassName={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium backdrop-blur-sm cursor-pointer hover:ring-1 hover:ring-white/20 transition-all focus:outline-none focus:ring-1 focus:ring-white/20 ${getStatusStyle(engagement.status)} ${flashTextFor(engagement.id, 'status')}`}
          />
        )}
      </td>
      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setNotesModalEngagement(engagement)}
          className={`relative inline-flex items-center justify-center p-1.5 transition-colors ${
            (engagement.noteCount ?? 0) > 0 || engagement.notes
              ? 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400'
              : 'bg-zinc-800/50 hover:bg-zinc-700/50 text-muted hover:text-muted'
          } ${flashTextFor(engagement.id, 'noteCount')}`}
          title={(engagement.noteCount ?? 0) > 0 || engagement.notes ? 'View notes' : 'Add notes'}
        >
          <FileText className="w-4 h-4" />
          {(engagement.noteCount ?? 0) > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 bg-cyan-500 text-black text-[9px] font-bold flex items-center justify-center rounded-full leading-none">
              {(engagement.noteCount ?? 0) > 9 ? '9+' : engagement.noteCount}
            </span>
          )}
        </button>
      </td>
    </tr>
    );
  };

  // Common props for every header — derives the active state from sortIndex.
  const headerProps = (column: SortColumn) => ({
    column,
    active: sortIndex.get(column),
    totalActive: sortBy.length,
    onSort: onSort as (column: SortColumn, shift: boolean) => void,
  });

  // Render table header
  const renderTableHeader = () => (
    <thead className="sticky top-0 bg-zinc-800/95 backdrop-blur-sm z-10">
      <tr>
        <SortableHeader label="External Client" {...headerProps('externalClient')} />
        <SortableHeader label="Internal Client" {...headerProps('internalClient')} />
        <SortableHeader label="Intake Type" {...headerProps('intakeType')} />
        <SortableHeader label="Project Type" {...headerProps('type')} />
        <SortableHeader label="Team Members" {...headerProps('teamMembers')} />
        <SortableHeader label="Date Started" {...headerProps('dateStarted')} />
        <SortableHeader label="Date Finished" {...headerProps('dateFinished')} />
        <SortableHeader label="Model Logged" {...headerProps('portfolioLogged')} />
        <SortableHeader label="NNA" {...headerProps('nna')} centered />
        <SortableHeader label="Status" {...headerProps('status')} />
        <th className="text-center text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Notes</th>
      </tr>
    </thead>
  );

  // Render pagination
  const renderPagination = (isFullscreenMode: boolean = false) => (
    <div className={`relative z-10 px-4 py-3 flex items-center justify-end border-t border-zinc-800/50 flex-shrink-0 ${isFullscreenMode ? 'bg-zinc-900' : 'bg-zinc-900/80 backdrop-blur-sm'}`}>
      <div className="flex items-center gap-1">
        <button
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className={`px-3 py-1.5 text-xs border border-zinc-700/50 transition-colors ${isFullscreenMode ? '' : 'backdrop-blur-sm'} ${currentPage === 1
              ? 'text-muted cursor-not-allowed'
              : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200'
            }`}
        >
          Previous
        </button>
        {getPageNumbers().map((page, idx) =>
          page === 'ellipsis' ? (
            <span key={`ellipsis-${isFullscreenMode ? 'fs-' : ''}${idx}`} className="px-2 py-1.5 text-xs text-muted">
              ...
            </span>
          ) : (
            <button
              key={`${isFullscreenMode ? 'fs-' : ''}${page}`}
              onClick={() => setCurrentPage(page)}
              className={`px-3 py-1.5 text-xs transition-colors ${currentPage === page
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white'
                  : `border border-zinc-700/50 hover:bg-white/[0.03] text-muted hover:text-zinc-200 ${isFullscreenMode ? '' : 'backdrop-blur-sm'}`
                }`}
            >
              {page}
            </button>
          )
        )}
        <button
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className={`px-3 py-1.5 text-xs border border-zinc-700/50 transition-colors ${isFullscreenMode ? '' : 'backdrop-blur-sm'} ${currentPage === totalPages
              ? 'text-muted cursor-not-allowed'
              : 'text-muted hover:bg-white/[0.03] hover:text-zinc-200'
            }`}
        >
          Next
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Notes Modal */}
      <NotesModal
        isOpen={notesModalEngagement !== null}
        onClose={() => setNotesModalEngagement(null)}
        title="Notes"
        subtitle={notesModalEngagement?.externalClient || notesModalEngagement?.internalClient.name || ''}
        engagementId={notesModalEngagement?.id ?? 0}
        readOnly={readOnly || !canUserEditEngagement(currentUser, notesModalEngagement?.teamMembers ?? [])}
        filepath={notesModalEngagement?.filepath ?? null}
        canEditFilepath={!readOnly && canUserEditEngagement(currentUser, notesModalEngagement?.teamMembers ?? [])}
        onFilepathSaved={(next) => {
          if (notesModalEngagement) {
            onFilepathSaved(notesModalEngagement.id, next);
            setNotesModalEngagement({ ...notesModalEngagement, filepath: next });
          }
        }}
        onNoteAdded={() => {
          if (notesModalEngagement) {
            onNoteAdded(notesModalEngagement.id);
          }
        }}
        onNoteDeleted={() => {
          if (notesModalEngagement) {
            onNoteDeleted(notesModalEngagement.id);
          }
        }}
      />

      {/* NNA Modal */}
      <NNAModal
        isOpen={nnaModalEngagement !== null}
        onClose={() => setNnaModalEngagement(null)}
        engagementId={nnaModalEngagement?.id ?? 0}
        externalClient={nnaModalEngagement?.externalClient ?? null}
        internalClient={nnaModalEngagement?.internalClient.name ?? ''}
        currentNNA={nnaModalEngagement?.nna}
        onSave={onNNAChange}
      />

      {/* Main Table */}
      <div className="relative overflow-hidden bg-zinc-900/60 backdrop-blur-md border border-zinc-800/50 rounded-xl flex flex-col min-h-[380px]">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        {/* Table Header with Fullscreen Toggle */}
        <div className="relative z-10 px-4 py-2 flex items-center justify-between border-b border-zinc-800/50 flex-shrink-0">
          <h3 className="text-sm font-medium text-white">Interactions</h3>
          <div className="flex items-center gap-4">
            <p className="text-xs text-muted">
              Showing <span className="text-muted font-medium">{((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, engagements.length)}</span> of <span className="text-muted font-medium">{engagements.length}</span>
            </p>
            <button onClick={onExport} disabled={isExporting} className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" title="Download table data">
              {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Export
            </button>
            <button
              onClick={() => setIsFullscreen(true)}
              className="p-1.5 text-muted hover:text-cyan-400 hover:bg-white/[0.05] transition-colors"
              title="Expand table"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative z-10 flex-1 overflow-auto min-h-0 scrollbar-thin">
          <table className="w-full">
            {renderTableHeader()}
            <tbody className="divide-y divide-zinc-800/50">
              {paginatedEngagements.map((engagement) => renderTableRow(engagement))}
              {ghostRows.map(({ engagement }) => renderTableRow(engagement, '', true))}
            </tbody>
          </table>
        </div>

        {renderPagination()}
      </div>

      {/* Fullscreen Table Overlay */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-16">
          {/* Dimmed backdrop */}
          <div
            className="absolute inset-0 bg-black/80"
            onClick={() => setIsFullscreen(false)}
          />

          {/* Fullscreen table container */}
          <div className="relative w-full h-full bg-zinc-900 border border-zinc-700/50 rounded-xl flex flex-col shadow-2xl overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

            {/* Header with close button */}
            <div className="relative z-10 px-4 py-3 flex items-center justify-between border-b border-zinc-800/50 flex-shrink-0">
              <h3 className="text-sm font-medium text-white">Interactions</h3>
              <div className="flex items-center gap-4">
                <p className="text-xs text-muted">
                  Showing <span className="text-muted font-medium">{((currentPage - 1) * pageSize) + 1}–{Math.min(currentPage * pageSize, engagements.length)}</span> of <span className="text-muted font-medium">{engagements.length}</span>
                </p>
                <button onClick={onExport} disabled={isExporting} className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted hover:text-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" title="Download table data">
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Export
                </button>
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="p-1.5 text-muted hover:text-cyan-400 hover:bg-white/[0.05] transition-colors"
                  title="Exit fullscreen"
                >
                  <Minimize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Table content */}
            <div className="relative z-10 flex-1 overflow-auto min-h-0 scrollbar-thin">
              <table className="w-full">
                <thead className="sticky top-0 bg-zinc-800 z-10">
                  <tr>
                    <SortableHeader label="External Client" {...headerProps('externalClient')} />
                    <SortableHeader label="Internal Client" {...headerProps('internalClient')} />
                    <SortableHeader label="Intake Type" {...headerProps('intakeType')} />
                    <SortableHeader label="Project Type" {...headerProps('type')} />
                    <SortableHeader label="Team Members" {...headerProps('teamMembers')} />
                    <SortableHeader label="Date Started" {...headerProps('dateStarted')} />
                    <SortableHeader label="Date Finished" {...headerProps('dateFinished')} />
                    <SortableHeader label="Model Logged" {...headerProps('portfolioLogged')} />
                    <SortableHeader label="NNA" {...headerProps('nna')} centered />
                    <SortableHeader label="Status" {...headerProps('status')} />
                    <th className="text-center text-xs font-medium text-muted uppercase tracking-wider px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {paginatedEngagements.map((engagement) => renderTableRow(engagement, 'fs-'))}
                  {ghostRows.map(({ engagement }) => renderTableRow(engagement, 'fs-', true))}
                </tbody>
              </table>
            </div>

            {renderPagination(true)}
          </div>
        </div>
      )}
    </>
  );
};

export default InteractionsTable;
