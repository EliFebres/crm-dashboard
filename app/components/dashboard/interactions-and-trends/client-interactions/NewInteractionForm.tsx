'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, ChevronDown, Check, DollarSign, Briefcase, FileText, Link2, AlertTriangle } from 'lucide-react';
import NNAModal from '@/app/components/dashboard/interactions-and-trends/client-interactions/NNAModal';
import PortfolioModal from '@/app/components/dashboard/interactions-and-trends/client-interactions/PortfolioModal';
import NotesModal from '@/app/components/dashboard/interactions-and-trends/client-interactions/NotesModal';
import LinkInteractionModal from '@/app/components/dashboard/interactions-and-trends/client-interactions/LinkInteractionModal';
import { Select } from '@/app/components/ui/Select';
import { PortfolioHolding, EngagementLinkSummary, Client } from '@/app/lib/types/engagements';
import {
  getInternalClients, InternalClientOption, searchEngagementsForLink,
  getClients, registerClient, updateClient, getCrnConfig, CrnConfigResponse, ClientConflictError,
} from '@/app/lib/api/client-interactions';
import { getDepartments } from '@/app/lib/api/internal-clients';
import { useCurrentUser } from '@/app/lib/auth/context';
import { canUserEditEngagement, type TeamMember } from '@/app/lib/auth/types';

export interface InteractionFormData {
  clientCrn: string;          // CRN of the selected registered external client (required)
  clientCrnPending?: boolean; // true when clientCrn is a placeholder awaiting the real value
  externalClient: string;     // Canonical name of the selected client (display only)
  internalClient: string;
  internalClientDept: string; // A managed department name, or '' when unset
  intakeType: 'IRQ' | 'SERF' | 'Ad-Hoc' | '';
  adHocChannel?: 'In-Person' | 'Email' | 'Teams';
  projectType: string;
  teamMembers: string[];
  dateStarted: string;
  dateFinished?: string;
  status?: string;
  notes: string;
  portfolioLogged: boolean;
  portfolio?: PortfolioHolding[];
  nna: number | null;
  tickersMentioned?: string[]; // Only for Ad-Hoc - tickers discussed during interaction
  linkedFromId?: number | null; // Parent engagement this one is the result of (funnel KPIs)
  linkedFromPreview?: EngagementLinkSummary | null; // Cached preview so we can render the chip without re-fetching
}

export interface EditingEngagement {
  id: number;
  data: InteractionFormData;
  originalDateStarted: string; // Preserve exact original string to avoid roundtrip changes
  originalDateFinished?: string; // Preserve exact original string to avoid roundtrip changes
  version?: number; // Optimistic locking — sent back on save to detect concurrent edits
  createdById?: string; // User ID of the creator — used to determine delete permission
  filepath?: string | null; // Project folder path — shown/edited in the Notes modal
}

interface NewInteractionFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: InteractionFormData) => void;
  onUpdate?: (id: number, data: InteractionFormData) => void;
  onDelete?: (id: number) => void;
  editingEngagement?: EditingEngagement | null;
  initialNoteCount?: number;
  onNoteAdded?: (engagementId: number) => void;
  onNoteDeleted?: (engagementId: number) => void;
  onFilepathSaved?: (engagementId: number, filepath: string | null) => void;
  onBulkUploadClick?: () => void;
}

// Project types by intake
const projectTypesByIntake = {
  'IRQ': ['Meeting', 'Discovery Meeting', 'Data Request', 'Data Update', 'PCR', 'Follow-up Material', 'Follow-up Meeting'],
  'SERF': ['Meeting', 'Discovery Meeting', 'Data Request', 'Data Update', 'PCR', 'Follow-up Material', 'Follow-up Meeting'],
  'Ad-Hoc': ['PCR', 'Discovery Meeting', 'Data Request', 'Data Update', 'Other'],
};

// Format NNA for display
const formatNNADisplay = (value: number | null): string => {
  if (!value || value === 0) return '—';
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
};

export default function NewInteractionForm({ isOpen, onClose, onSubmit, onUpdate, onDelete, editingEngagement, initialNoteCount, onNoteAdded, onNoteDeleted, onFilepathSaved, onBulkUploadClick }: NewInteractionFormProps) {
  const isEditMode = !!editingEngagement;
  const { user: currentUser } = useCurrentUser();

  const getDefaultFormData = (): InteractionFormData => ({
    clientCrn: '',
    clientCrnPending: false,
    externalClient: '',
    internalClient: '',
    internalClientDept: '',
    intakeType: '',
    projectType: '',
    teamMembers: [],
    dateStarted: new Date().toISOString().split('T')[0],
    status: 'In Progress',
    notes: '',
    portfolioLogged: false,
    portfolio: undefined,
    nna: null,
    tickersMentioned: [],
    linkedFromId: null,
    linkedFromPreview: null,
  });

  const [formData, setFormData] = useState<InteractionFormData>(getDefaultFormData());

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [internalClients, setInternalClients] = useState<InternalClientOption[]>([]);
  const [internalClientsLoading, setInternalClientsLoading] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);
  const [internalClientSearch, setInternalClientSearch] = useState('');
  const [showInternalClientDropdown, setShowInternalClientDropdown] = useState(false);
  // External client registry (keyed by CRN)
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [crnConfig, setCrnConfig] = useState<CrnConfigResponse | null>(null);
  const [registeringClient, setRegisteringClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientCrn, setNewClientCrn] = useState('');
  const [registerPending, setRegisterPending] = useState(false); // "I don't have the CRN yet"
  const [registerError, setRegisterError] = useState('');
  const [registerBusy, setRegisterBusy] = useState(false);
  // Inline flow for filling in a selected pending client's real CRN.
  const [resolvingCrn, setResolvingCrn] = useState(false);
  const [resolveCrnInput, setResolveCrnInput] = useState('');
  const [resolveError, setResolveError] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);
  const externalClientRef = useRef<HTMLDivElement>(null);
  const [isNNAModalOpen, setIsNNAModalOpen] = useState(false);
  const [isPortfolioModalOpen, setIsPortfolioModalOpen] = useState(false);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [localNoteCount, setLocalNoteCount] = useState(initialNoteCount ?? 0);
  // Filepath for the Notes modal — kept in local state so a save there updates the
  // displayed value live without reopening. Synced from editingEngagement on open.
  const [notesFilepath, setNotesFilepath] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const internalClientRef = useRef<HTMLDivElement>(null);
  const [teamMembersByOffice, setTeamMembersByOffice] = useState<Record<string, TeamMember[]>>({});

  // Close the searchable internal-client dropdown when clicking outside.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (internalClientRef.current && !internalClientRef.current.contains(event.target as Node)) {
        setShowInternalClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close the external-client registry dropdown when clicking outside.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (externalClientRef.current && !externalClientRef.current.contains(event.target as Node)) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch the CRN sourcing mode once the form opens (drives the register UI).
  useEffect(() => {
    if (!isOpen) return;
    getCrnConfig().then(setCrnConfig).catch(() => setCrnConfig({ autoGenerate: false, prefix: '' }));
  }, [isOpen]);

  // Search the client registry (by name OR CRN), debounced.
  useEffect(() => {
    if (!isOpen) return;
    const handle = setTimeout(() => {
      getClients(clientSearch.trim()).then(setClients).catch(() => setClients([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [isOpen, clientSearch]);

  // Fetch team members for current user's team
  useEffect(() => {
    if (!currentUser) return;
    fetch(`/api/team-members?team=${encodeURIComponent(currentUser.team)}`)
      .then(r => r.json())
      .then((members: TeamMember[]) => {
        const grouped = members.reduce((acc, m) => {
          if (!acc[m.office]) acc[m.office] = [];
          acc[m.office].push(m);
          return acc;
        }, {} as Record<string, TeamMember[]>);
        setTeamMembersByOffice(grouped);
      })
      .catch(() => setTeamMembersByOffice({}));
  }, [currentUser]);

  // Fetch internal clients + the managed department list fresh each time the form opens
  useEffect(() => {
    if (!isOpen) return;
    setInternalClientsLoading(true);
    getInternalClients()
      .then(setInternalClients)
      .catch(() => setInternalClients([]))
      .finally(() => setInternalClientsLoading(false));
    getDepartments()
      .then(items => setDepartments(items.map(d => d.name)))
      .catch(() => setDepartments([]));
  }, [isOpen]);

  // Reset form when opened (or populate with editing data)
  useEffect(() => {
    if (isOpen) {
      if (editingEngagement) {
        // Pre-fill with existing data for editing
        setFormData(editingEngagement.data);
      } else {
        // Reset to defaults for new interaction
        setFormData(getDefaultFormData());
      }
      setErrors({});
      setInternalClientSearch('');
      setShowInternalClientDropdown(false);
      setClientSearch('');
      setShowClientDropdown(false);
      setRegisteringClient(false);
      setNewClientName('');
      setNewClientCrn('');
      setRegisterPending(false);
      setRegisterError('');
      setResolvingCrn(false);
      setResolveCrnInput('');
      setResolveError('');
      setTickerInput('');
      setLocalNoteCount(initialNoteCount ?? 0);
      setNotesFilepath(editingEngagement?.filepath ?? null);
      setDeleteConfirm(false);
    }
  }, [isOpen, editingEngagement, initialNoteCount]);

  // If we have a linkedFromId but no preview (e.g. opened an existing engagement that had a link),
  // fetch the slim summary so we can render the chip.
  const { linkedFromId: linkedFromIdDep, linkedFromPreview: linkedFromPreviewDep } = formData;
  useEffect(() => {
    if (!isOpen) return;
    if (!linkedFromIdDep || linkedFromPreviewDep) return;
    let cancelled = false;
    searchEngagementsForLink({ id: linkedFromIdDep, limit: 1 })
      .then(rows => {
        if (cancelled) return;
        const hit = rows[0];
        if (hit) setFormData(prev => ({ ...prev, linkedFromPreview: hit }));
      })
      .catch(() => { /* non-fatal — chip will show minimal info */ });
    return () => { cancelled = true; };
  }, [isOpen, linkedFromIdDep, linkedFromPreviewDep]);

  // Clients matching the current search, grouped by department
  const trimmedSearch = internalClientSearch.trim();
  const filteredClientGroups = useMemo(() => {
    const filtered = trimmedSearch
      ? internalClients.filter(c => c.name.toLowerCase().includes(trimmedSearch.toLowerCase()))
      : internalClients;
    const groups: Record<string, string[]> = {};
    filtered.forEach(c => {
      if (!groups[c.dept]) groups[c.dept] = [];
      groups[c.dept].push(c.name);
    });
    return Object.entries(groups);
  }, [internalClients, trimmedSearch]);

  // True when the typed name doesn't match any existing client exactly
  const isNewClient = trimmedSearch.length > 0 &&
    !internalClients.some(c => c.name.toLowerCase() === trimmedSearch.toLowerCase());

  // Get available project types based on intake type
  const availableProjectTypes = formData.intakeType
    ? (projectTypesByIntake[formData.intakeType as keyof typeof projectTypesByIntake] || [])
    : [];

  // Reset project type when intake type changes (only if current project type is invalid)
  useEffect(() => {
    if (formData.intakeType && formData.projectType && !availableProjectTypes.includes(formData.projectType)) {
      setFormData(prev => ({ ...prev, projectType: '' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.intakeType]);

  // Register a brand-new external client, then select it.
  const handleRegisterClient = async () => {
    const name = newClientName.trim();
    if (!name) {
      setRegisterError('Client name is required.');
      return;
    }
    const manual = !crnConfig?.autoGenerate;
    // In manual mode the user can register without a CRN ("add it later") — the
    // server assigns a highlighted placeholder CRN.
    const wantPending = manual && registerPending;
    const crn = newClientCrn.trim();
    if (manual && !wantPending && !crn) {
      setRegisterError('CRN is required.');
      return;
    }
    setRegisterBusy(true);
    setRegisterError('');
    try {
      const client = await registerClient(name, manual && !wantPending ? crn : undefined, { pending: wantPending });
      setFormData(prev => ({ ...prev, clientCrn: client.crn, externalClient: client.name, clientCrnPending: client.crnPending ?? false }));
      setClients(prev => (prev.some(c => c.crn === client.crn) ? prev : [client, ...prev]));
      setRegisteringClient(false);
      setNewClientName('');
      setNewClientCrn('');
      setRegisterPending(false);
      setClientSearch('');
      setShowClientDropdown(false);
      setErrors(prev => { const n = { ...prev }; delete n.externalClient; return n; });
    } catch (err) {
      setRegisterError(
        err instanceof ClientConflictError ? err.message
          : err instanceof Error ? err.message
          : 'Failed to register client.'
      );
    } finally {
      setRegisterBusy(false);
    }
  };

  // Replace a selected pending client's placeholder CRN with the real value. This
  // cascades to every interaction referencing the placeholder, and updates this form.
  const handleResolveCrn = async () => {
    const real = resolveCrnInput.trim();
    if (!real) {
      setResolveError('Enter the real CRN.');
      return;
    }
    setResolveBusy(true);
    setResolveError('');
    try {
      const updated = await updateClient(formData.clientCrn, { crn: real, name: formData.externalClient });
      const prevCrn = formData.clientCrn;
      setFormData(prev => ({ ...prev, clientCrn: updated.crn, externalClient: updated.name, clientCrnPending: updated.crnPending ?? false }));
      setClients(prev => prev.map(c => (c.crn === prevCrn ? { ...c, crn: updated.crn, name: updated.name, crnPending: updated.crnPending ?? false } : c)));
      setResolvingCrn(false);
      setResolveCrnInput('');
    } catch (err) {
      setResolveError(
        err instanceof ClientConflictError ? err.message
          : err instanceof Error ? err.message
          : 'Failed to update CRN.'
      );
    } finally {
      setResolveBusy(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.intakeType) {
      newErrors.intakeType = 'Intake type is required';
    }

    if (!formData.clientCrn) {
      newErrors.externalClient = 'Client (CRN) is required';
    }

    if (!formData.internalClient) {
      newErrors.internalClient = 'Internal client is required';
    } else if (!formData.internalClientDept) {
      newErrors.internalClient = 'Department is required';
    }

    if (!formData.projectType) {
      newErrors.projectType = 'Project type is required';
    }

    if (formData.teamMembers.length === 0) {
      newErrors.teamMembers = 'At least one team member is required';
    }

    if (!formData.dateStarted) {
      newErrors.dateStarted = 'Start date is required';
    }

    if (formData.intakeType === 'Ad-Hoc' && !formData.adHocChannel) {
      newErrors.adHocChannel = 'Channel is required for Ad-Hoc';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateForm()) {
      const submissionData = { ...formData };

      if (isEditMode && editingEngagement && onUpdate) {
        // Update existing interaction
        onUpdate(editingEngagement.id, submissionData);
      } else {
        // Create new interaction — keep any NNA the user entered on the form
        onSubmit(submissionData);
      }
      onClose();
    }
  };

  const toggleTeamMember = (member: string) => {
    setFormData(prev => ({
      ...prev,
      teamMembers: prev.teamMembers.includes(member)
        ? prev.teamMembers.filter(m => m !== member)
        : [...prev.teamMembers, member]
    }));
  };

  const addTickers = (input: string) => {
    const newTickers = input
      .split(/[,\s]+/)
      .map(t => t.trim().toUpperCase())
      .filter(t => t.length > 0 && !formData.tickersMentioned?.includes(t));

    if (newTickers.length > 0) {
      setFormData(prev => ({
        ...prev,
        tickersMentioned: [...(prev.tickersMentioned || []), ...newTickers]
      }));
    }
    setTickerInput('');
  };

  const removeTicker = (ticker: string) => {
    setFormData(prev => ({
      ...prev,
      tickersMentioned: prev.tickersMentioned?.filter(t => t !== ticker) || []
    }));
  };

  const handleTickerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTickers(tickerInput);
    } else if (e.key === 'Backspace' && !tickerInput && formData.tickersMentioned?.length) {
      // Remove last ticker if backspace pressed on empty input
      const tickers = formData.tickersMentioned;
      removeTicker(tickers[tickers.length - 1]);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Form Panel - Centered */}
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-8 pointer-events-none"
      >
        <div
          className="w-full max-w-2xl max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto overflow-hidden"
        >
        <div className="flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {isEditMode ? 'Edit Interaction' : 'New Interaction'}
              </h2>
              <p className="text-sm text-muted">
                {isEditMode ? 'Update the client interaction record' : 'Create a new client interaction record'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!isEditMode && onBulkUploadClick && (
                <button
                  type="button"
                  onClick={onBulkUploadClick}
                  className="px-3 py-1.5 text-sm text-muted hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                >
                  ↑ Bulk Upload
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 text-muted hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto min-h-0">
            <div className="p-6 space-y-4">
              {/* Row 1: Intake Type + Project Type + Interaction Type for Ad-Hoc */}
              <div className={`grid gap-4 ${formData.intakeType === 'Ad-Hoc' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Intake Type <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.intakeType}
                      onChange={(e) => setFormData(prev => ({ ...prev, intakeType: e.target.value as 'IRQ' | 'SERF' | 'Ad-Hoc' | '', adHocChannel: undefined }))}
                      className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                    >
                      <option value="" className="bg-zinc-800">Select...</option>
                      <option value="IRQ" className="bg-zinc-800">IRQ</option>
                      <option value="SERF" className="bg-zinc-800">SERF</option>
                      <option value="Ad-Hoc" className="bg-zinc-800">Ad-Hoc</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                  </div>
                  {errors.intakeType && <p className="mt-1 text-xs text-red-400">{errors.intakeType}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Project Type <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={formData.projectType}
                      onChange={(e) => setFormData(prev => ({ ...prev, projectType: e.target.value }))}
                      className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                    >
                      <option value="" className="bg-zinc-800">Select...</option>
                      {availableProjectTypes.map(type => (
                        <option key={type} value={type} className="bg-zinc-800">{type}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                  </div>
                  {errors.projectType && <p className="mt-1 text-xs text-red-400">{errors.projectType}</p>}
                </div>
                {formData.intakeType === 'Ad-Hoc' && (
                  <div>
                    <label className="block text-sm font-medium text-muted mb-1.5">
                      Interaction Type <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <select
                        value={formData.adHocChannel || ''}
                        onChange={(e) => setFormData(prev => ({ ...prev, adHocChannel: e.target.value as 'In-Person' | 'Email' | 'Teams' }))}
                        className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none cursor-pointer"
                      >
                        <option value="" className="bg-zinc-800">Select...</option>
                        <option value="In-Person" className="bg-zinc-800">In-Person</option>
                        <option value="Email" className="bg-zinc-800">Email</option>
                        <option value="Teams" className="bg-zinc-800">Teams</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                    </div>
                    {errors.adHocChannel && <p className="mt-1 text-xs text-red-400">{errors.adHocChannel}</p>}
                  </div>
                )}
              </div>

              {/* Linked From Previous Interaction */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">
                  Link to Previous Interaction <span className="text-muted font-normal text-xs">(Optional: Is this a follow-up or result of a prior interaction?)</span>
                </label>
                {formData.linkedFromId ? (
                  <div className="flex items-center justify-between gap-2 px-3 h-[38px] bg-cyan-500/10 border border-cyan-500/40 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link2 className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                      <div className="text-sm text-cyan-300 truncate">
                        {formData.linkedFromPreview ? (
                          <>
                            <span className="font-medium">{formData.linkedFromPreview.type}</span>
                            <span className="text-cyan-500/70"> · {formData.linkedFromPreview.intakeType}</span>
                            <span className="text-cyan-500/70"> · {formData.linkedFromPreview.internalClientName}</span>
                            <span className="text-cyan-500/50"> · {formData.linkedFromPreview.dateStarted}</span>
                          </>
                        ) : (
                          <>Interaction #{formData.linkedFromId}</>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsLinkModalOpen(true)}
                        className="text-xs text-cyan-400 hover:text-cyan-200 transition-colors px-2 py-1"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, linkedFromId: null, linkedFromPreview: null }))}
                        className="p-1 text-cyan-400 hover:text-cyan-200 transition-colors"
                        aria-label="Clear link"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsLinkModalOpen(true)}
                    className="w-full h-[38px] px-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-left text-muted hover:border-cyan-500/50 transition-colors flex items-center gap-2"
                  >
                    <Link2 className="w-4 h-4" />
                    + Link a previous interaction
                  </button>
                )}
              </div>

              {/* Tickers Mentioned - Only for Ad-Hoc */}
              {formData.intakeType === 'Ad-Hoc' && (
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Tickers Mentioned <span className="text-muted font-normal text-xs">(Optional - for Ticker Trends)</span>
                  </label>
                  <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-800/50 border border-zinc-700 rounded-lg min-h-[42px] focus-within:border-cyan-500/50 transition-colors">
                    {formData.tickersMentioned?.map((ticker) => (
                      <span
                        key={ticker}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-cyan-500/20 border border-cyan-500/30 rounded text-xs font-medium text-cyan-400"
                      >
                        {ticker}
                        <button
                          type="button"
                          onClick={() => removeTicker(ticker)}
                          className="hover:text-cyan-200 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tickerInput}
                      onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                      onKeyDown={handleTickerKeyDown}
                      onBlur={() => tickerInput && addTickers(tickerInput)}
                      placeholder={formData.tickersMentioned?.length ? '' : 'Type tickers (e.g., AAPL, MSFT)...'}
                      className="flex-1 min-w-[120px] bg-transparent border-none text-white text-sm placeholder-zinc-500 focus:outline-none"
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">Press Enter or comma to add. Used for Ticker Trends analytics.</p>
                </div>
              )}

              {/* Row 2: External Client + Internal Client */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative" ref={externalClientRef}>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    External Client <span className="text-red-400">*</span>
                  </label>
                  {!registeringClient ? (
                    <>
                      <div className="relative">
                        <input
                          type="text"
                          value={formData.externalClient || clientSearch}
                          onChange={(e) => {
                            setClientSearch(e.target.value);
                            setFormData(prev => ({ ...prev, clientCrn: '', externalClient: '', clientCrnPending: false }));
                            setShowClientDropdown(true);
                            setResolvingCrn(false);
                          }}
                          onFocus={() => setShowClientDropdown(true)}
                          placeholder="Search by name or CRN..."
                          className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                        />
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                      </div>
                      {formData.clientCrn && !formData.clientCrnPending && (
                        <p className="mt-1 text-xs text-muted">CRN: <span className="text-cyan-400">{formData.clientCrn}</span></p>
                      )}
                      {formData.clientCrn && formData.clientCrnPending && (
                        <div className="mt-1.5 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                          {!resolvingCrn ? (
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-red-400">
                                <AlertTriangle className="w-3 h-3" /> CRN Pending
                              </span>
                              <button
                                type="button"
                                onClick={() => { setResolvingCrn(true); setResolveCrnInput(''); setResolveError(''); }}
                                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                              >
                                + Add real CRN
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <input
                                type="text"
                                value={resolveCrnInput}
                                onChange={(e) => setResolveCrnInput(e.target.value)}
                                placeholder={`Real CRN${crnConfig?.prefix ? ` (e.g. ${crnConfig.prefix}000123)` : ''}`}
                                className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                              />
                              {resolveError && <p className="text-xs text-red-400">{resolveError}</p>}
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={handleResolveCrn}
                                  disabled={resolveBusy}
                                  className="px-3 py-1 text-xs rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
                                >
                                  {resolveBusy ? 'Saving…' : 'Save CRN'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setResolvingCrn(false); setResolveError(''); }}
                                  className="px-3 py-1 text-xs rounded-lg bg-zinc-700/50 text-muted hover:bg-zinc-700 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {showClientDropdown && (
                        <div className="absolute z-50 w-full mt-1 max-h-52 overflow-y-auto bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl">
                          {clients.length > 0 ? (
                            clients.map(c => (
                              <button
                                key={c.crn}
                                type="button"
                                onClick={() => {
                                  setFormData(prev => ({ ...prev, clientCrn: c.crn, externalClient: c.name, clientCrnPending: c.crnPending ?? false }));
                                  setClientSearch('');
                                  setShowClientDropdown(false);
                                  setResolvingCrn(false);
                                  setErrors(prev => { const n = { ...prev }; delete n.externalClient; return n; });
                                }}
                                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                                  formData.clientCrn === c.crn
                                    ? 'bg-cyan-500/20 text-cyan-400'
                                    : 'text-muted hover:bg-zinc-700/50'
                                }`}
                              >
                                <span className="block text-white">{c.name}</span>
                                {c.crnPending ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-red-400">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide">CRN Pending</span>
                                  </span>
                                ) : (
                                  <span className="block text-xs text-muted">{c.crn}</span>
                                )}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-3 text-sm text-muted text-center">No matching clients</div>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setRegisteringClient(true);
                              setNewClientName(clientSearch.trim());
                              setNewClientCrn('');
                              setRegisterPending(false);
                              setRegisterError('');
                              setShowClientDropdown(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-cyan-400 hover:bg-zinc-700/50 flex items-center gap-2 border-t border-zinc-700/50"
                          >
                            <span className="text-muted text-base leading-none">+</span>
                            Register new client
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2 p-3 bg-zinc-800/40 border border-zinc-700 rounded-lg">
                      <input
                        type="text"
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                        placeholder="Client name"
                        className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                      />
                      {crnConfig?.autoGenerate ? (
                        <p className="text-xs text-muted">A CRN will be generated automatically.</p>
                      ) : (
                        <>
                          {!registerPending && (
                            <input
                              type="text"
                              value={newClientCrn}
                              onChange={(e) => setNewClientCrn(e.target.value)}
                              placeholder={`CRN${crnConfig?.prefix ? ` (e.g. ${crnConfig.prefix}000123)` : ''}`}
                              className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                            />
                          )}
                          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={registerPending}
                              onChange={(e) => { setRegisterPending(e.target.checked); setRegisterError(''); }}
                              className="accent-cyan-500"
                            />
                            I don&apos;t have the CRN yet — add it later
                          </label>
                          {registerPending && (
                            <p className="inline-flex items-center gap-1 text-xs text-red-400">
                              <AlertTriangle className="w-3 h-3" />
                              A placeholder CRN will be used and highlighted until you add the real one.
                            </p>
                          )}
                        </>
                      )}
                      {registerError && <p className="text-xs text-red-400">{registerError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleRegisterClient}
                          disabled={registerBusy}
                          className="px-3 py-1.5 text-sm rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
                        >
                          {registerBusy ? 'Saving…' : 'Register'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setRegisteringClient(false); setRegisterPending(false); setRegisterError(''); }}
                          className="px-3 py-1.5 text-sm rounded-lg bg-zinc-700/50 text-muted hover:bg-zinc-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {errors.externalClient && <p className="mt-1 text-xs text-red-400">{errors.externalClient}</p>}
                </div>
                <div className="relative" ref={internalClientRef}>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Internal Client <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.internalClient || internalClientSearch}
                      onChange={(e) => {
                        setInternalClientSearch(e.target.value);
                        setFormData(prev => ({ ...prev, internalClient: '', internalClientDept: '' }));
                        setShowInternalClientDropdown(true);
                      }}
                      onFocus={() => setShowInternalClientDropdown(true)}
                      placeholder={internalClientsLoading ? 'Loading...' : 'Search or add a client...'}
                      className="w-full px-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
                  </div>
                  {/* Dropdown */}
                  {showInternalClientDropdown && !internalClientsLoading && (
                    <div className="absolute z-50 w-full mt-1 max-h-52 overflow-y-auto bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl">
                      {filteredClientGroups.length > 0 ? (
                        filteredClientGroups.map(([dept, names]) => (
                          <div key={dept}>
                            <div className="px-3 py-1.5 text-xs font-semibold text-muted uppercase tracking-wider bg-zinc-800/80 sticky top-0">
                              {dept}
                            </div>
                            {names.map(name => (
                              <button
                                key={name}
                                type="button"
                                onClick={() => {
                                  const client = internalClients.find(c => c.name === name)!;
                                  setFormData(prev => ({ ...prev, internalClient: name, internalClientDept: client.dept }));
                                  setInternalClientSearch('');
                                  setShowInternalClientDropdown(false);
                                }}
                                className={`w-full px-3 py-2 text-left text-sm transition-colors ${
                                  formData.internalClient === name
                                    ? 'bg-cyan-500/20 text-cyan-400'
                                    : 'text-muted hover:bg-zinc-700/50'
                                }`}
                              >
                                {name}
                              </button>
                            ))}
                          </div>
                        ))
                      ) : !trimmedSearch ? (
                        <div className="px-3 py-3 text-sm text-muted text-center">
                          No clients yet — type a name to add one
                        </div>
                      ) : null}
                      {/* "Add new client" option when typed name is new */}
                      {isNewClient && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormData(prev => ({ ...prev, internalClient: trimmedSearch, internalClientDept: '' }));
                            setInternalClientSearch('');
                            setShowInternalClientDropdown(false);
                          }}
                          className="w-full px-3 py-2 text-left text-sm text-cyan-400 hover:bg-zinc-700/50 flex items-center gap-2 border-t border-zinc-700/50"
                        >
                          <span className="text-muted text-base leading-none">+</span>
                          Add &quot;{trimmedSearch}&quot; as new internal client
                        </button>
                      )}
                    </div>
                  )}
                  {errors.internalClient && <p className="mt-1 text-xs text-red-400">{errors.internalClient}</p>}
                </div>
              </div>

              {/* Department row — shown when a client name is committed */}
              {formData.internalClient && (
                <div className="grid grid-cols-2 gap-4">
                  <div /> {/* spacer aligns with External Client column */}
                  <div>
                    {formData.internalClientDept ? (
                      /* Existing client — show dept as read-only */
                      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/30 border border-zinc-700/50 rounded-lg">
                        <span className="text-xs font-semibold text-muted uppercase tracking-wider">Dept</span>
                        <span className="text-sm text-muted">{formData.internalClientDept}</span>
                      </div>
                    ) : (
                      /* New client — dept selector */
                      <div>
                        <label className="block text-sm font-medium text-muted mb-1.5">
                          Department <span className="text-red-400">*</span>
                        </label>
                        <Select
                          value={formData.internalClientDept}
                          onValueChange={(v) => setFormData(prev => ({ ...prev, internalClientDept: v }))}
                          options={departments}
                          placeholder="Select department..."
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Row 3: Team Members (4 columns, grouped by office) */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">
                  Team Members <span className="text-red-400">*</span>
                </label>
                {Object.keys(teamMembersByOffice).length === 0 ? (
                  <p className="text-xs text-muted py-2">No team members configured yet.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(teamMembersByOffice).map(([office, members]) => (
                      <div key={office}>
                        {Object.keys(teamMembersByOffice).length > 1 && (
                          <p className="text-xs text-muted uppercase tracking-wider mb-1">{office}</p>
                        )}
                        <div className="grid grid-cols-4 gap-1.5">
                          {members.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              onClick={() => toggleTeamMember(member.displayName)}
                              className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-all flex items-center justify-between ${
                                formData.teamMembers.includes(member.displayName)
                                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400'
                                  : 'bg-zinc-800/50 border-zinc-700 text-muted hover:border-zinc-600'
                              }`}
                            >
                              <span className="truncate">{member.displayName}</span>
                              {formData.teamMembers.includes(member.displayName) && <Check className="w-3 h-3 ml-1 flex-shrink-0" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {errors.teamMembers && <p className="mt-1 text-xs text-red-400">{errors.teamMembers}</p>}
              </div>

              {/* Row 4: Date Started + Date Finished */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Date Started <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.dateStarted}
                    onClick={(e) => e.currentTarget.showPicker()}
                    onChange={(e) => setFormData(prev => ({ ...prev, dateStarted: e.target.value }))}
                    className="w-full h-[38px] px-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 transition-colors [&::-webkit-calendar-picker-indicator]:invert"
                  />
                  {errors.dateStarted && <p className="mt-1 text-xs text-red-400">{errors.dateStarted}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Date Finished <span className="text-muted font-normal text-xs">(Optional)</span>
                  </label>
                  <input
                    type="date"
                    value={formData.dateFinished || ''}
                    onClick={(e) => e.currentTarget.showPicker()}
                    onChange={(e) => setFormData(prev => {
                      const nextDateFinished = e.target.value || undefined;
                      // Auto-complete only when adding a date to an In Progress project.
                      // Any other status is left alone so users can track post-meeting follow-ups, etc.
                      const autoComplete = !!nextDateFinished && prev.status === 'In Progress';
                      return {
                        ...prev,
                        dateFinished: nextDateFinished,
                        status: autoComplete ? 'Completed' : prev.status,
                      };
                    })}
                    className="w-full h-[38px] px-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white focus:outline-none focus:border-cyan-500/50 transition-colors [&::-webkit-calendar-picker-indicator]:invert"
                  />
                </div>
              </div>

              {/* Row 5: NNA + Client Portfolio */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Net New Assets <span className="text-muted font-normal text-xs">(Optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsNNAModalOpen(true)}
                    className={`w-full h-[38px] px-3 bg-zinc-800/50 border rounded-lg text-sm text-left transition-colors flex items-center gap-2 ${
                      formData.nna
                        ? 'border-emerald-500/50 text-emerald-400 hover:border-emerald-500/70'
                        : 'border-zinc-700 text-muted hover:border-cyan-500/50'
                    }`}
                  >
                    <DollarSign className="w-4 h-4" />
                    {formData.nna ? formatNNADisplay(formData.nna) : '+ Add NNA'}
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">
                    Client Portfolio <span className="text-muted font-normal text-xs">(Optional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsPortfolioModalOpen(true)}
                    className={`w-full h-[38px] px-3 bg-zinc-800/50 border rounded-lg text-sm text-left transition-colors flex items-center gap-2 ${
                      formData.portfolio && formData.portfolio.length > 0
                        ? 'border-cyan-500/50 text-cyan-400 hover:border-cyan-500/70'
                        : 'border-zinc-700 text-muted hover:border-cyan-500/50'
                    }`}
                  >
                    <Briefcase className="w-4 h-4" />
                    {formData.portfolio && formData.portfolio.length > 0
                      ? `${formData.portfolio.length} holding${formData.portfolio.length > 1 ? 's' : ''}`
                      : '+ Add Portfolio'}
                  </button>
                </div>
              </div>

              {/* Row 6: Notes */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">
                  Notes <span className="text-muted font-normal text-xs">(Optional)</span>
                </label>
                {!editingEngagement?.id ? (
                  <div className="w-full h-[38px] px-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-sm text-muted flex items-center gap-2 cursor-not-allowed select-none">
                    <FileText className="w-4 h-4" />
                    Notes available after saving
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsNotesModalOpen(true)}
                    className={`w-full h-[38px] px-3 bg-zinc-800/50 border rounded-lg text-sm text-left transition-colors flex items-center gap-2 ${
                      localNoteCount > 0
                        ? 'border-cyan-500/50 text-cyan-400 hover:border-cyan-500/70'
                        : 'border-zinc-700 text-muted hover:border-cyan-500/50'
                    }`}
                  >
                    <FileText className="w-4 h-4" />
                    {localNoteCount > 0
                      ? `${localNoteCount} note${localNoteCount === 1 ? '' : 's'}`
                      : '+ Add Notes'}
                  </button>
                )}
              </div>
            </div>
          </form>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/80">
            <div className="flex items-center justify-between gap-3">
              <div>
                {isEditMode && onDelete && (currentUser?.role === 'admin' || currentUser?.id === editingEngagement?.createdById) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!deleteConfirm) { setDeleteConfirm(true); return; }
                      onDelete(editingEngagement!.id);
                      onClose();
                    }}
                    onBlur={() => setDeleteConfirm(false)}
                    className={deleteConfirm
                      ? 'px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors'
                      : 'px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors'}
                  >
                    {deleteConfirm ? 'Confirm Delete' : 'Delete'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={handleSubmit}
                className="px-6 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-medium rounded-lg hover:from-blue-500 hover:to-cyan-400 transition-all"
              >
                {isEditMode ? 'Save Changes' : 'Create Interaction'}
              </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>

      {/* NNA Modal */}
      <NNAModal
        isOpen={isNNAModalOpen}
        onClose={() => setIsNNAModalOpen(false)}
        engagementId={editingEngagement?.id || 0}
        externalClient={formData.externalClient}
        internalClient={formData.internalClient}
        currentNNA={formData.nna ?? undefined}
        onSave={(_, nna) => {
          setFormData(prev => ({ ...prev, nna: nna ?? null }));
        }}
      />

      {/* Portfolio Modal */}
      <PortfolioModal
        isOpen={isPortfolioModalOpen}
        onClose={() => setIsPortfolioModalOpen(false)}
        currentPortfolio={formData.portfolio}
        onSave={(portfolio) => {
          setFormData(prev => ({
            ...prev,
            portfolio,
            portfolioLogged: portfolio !== undefined && portfolio.length > 0,
          }));
        }}
      />

      {/* Link Previous Interaction Modal */}
      <LinkInteractionModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        onSelect={(summary) => {
          setFormData(prev => ({ ...prev, linkedFromId: summary.id, linkedFromPreview: summary }));
        }}
        defaultClient={formData.internalClient || undefined}
        excludeId={editingEngagement?.id}
      />

      {/* Notes Modal */}
      {editingEngagement?.id ? (
        <NotesModal
          isOpen={isNotesModalOpen}
          onClose={() => setIsNotesModalOpen(false)}
          title="Notes"
          subtitle={formData.externalClient || formData.internalClient || ''}
          engagementId={editingEngagement.id}
          readOnly={!canUserEditEngagement(currentUser, formData.teamMembers)}
          filepath={notesFilepath}
          canEditFilepath={canUserEditEngagement(currentUser, formData.teamMembers)}
          onFilepathSaved={(next) => {
            setNotesFilepath(next);
            onFilepathSaved?.(editingEngagement.id, next);
          }}
          onNoteAdded={() => {
            setLocalNoteCount(prev => prev + 1);
            onNoteAdded?.(editingEngagement.id);
          }}
          onNoteDeleted={() => {
            setLocalNoteCount(prev => Math.max(0, prev - 1));
            onNoteDeleted?.(editingEngagement.id);
          }}
        />
      ) : null}
    </>
  );
}
