'use client';

import React, { useState, useEffect } from 'react';
import { X, Briefcase, Loader2 } from 'lucide-react';
import type { ClientModel } from '@/app/lib/types/engagements';
import { getClientModels, saveClientModels } from '@/app/lib/api/client-interactions';
import ClientModelsEditor from './ClientModelsEditor';
import { useResizableModal } from '@/app/lib/hooks/useResizableModal';
import { ResizeHandle } from '@/app/components/ui/ResizeHandle';

interface PortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  clientCrn: string;
  clientName?: string;
  /**
   * The interaction this save is being made from, when there is one. Models logged by
   * the save are attributed to it; the export reads its Project ID through that link.
   * Null from Settings → Client Management, and from a new interaction that has no id
   * yet — in the latter case the caller replays `loggedModelIds` once it does.
   */
  loggedEngagementId?: number | null;
  /** Called after a successful save with the persisted models and the ids it logged. */
  onSaved?: (models: ClientModel[], loggedModelIds: string[]) => void;
}

// Outer wrapper keeps the body unmounted while closed — each reopen is a fresh
// mount that re-fetches the client's models for the current CRN.
const PortfolioModal: React.FC<PortfolioModalProps> = (props) => {
  if (!props.isOpen) return null;
  return <PortfolioModalBody {...props} />;
};

const PortfolioModalBody: React.FC<PortfolioModalProps> = ({ onClose, clientCrn, clientName, loggedEngagementId, onSaved }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seed, setSeed] = useState<ClientModel[]>([]);
  const [draft, setDraft] = useState<ClientModel[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { panelRef, panelStyle, startResize, resetSize } = useResizableModal('portfolio');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    getClientModels(clientCrn)
      .then(models => { if (active) { setSeed(models); setDraft(models); } })
      .catch(() => { if (active) setLoadError('Failed to load this client’s models.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientCrn]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { models, loggedModelIds } = await saveClientModels(clientCrn, draft, loggedEngagementId ?? null);
      onSaved?.(models, loggedModelIds);
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save models.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div ref={panelRef} style={panelStyle} className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-zinc-900 border border-zinc-700/50 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

        {/* Header */}
        <div className="relative z-10 flex-shrink-0 px-5 py-4 border-b border-zinc-800/50 flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium text-white">Client Models</h2>
            <p className="text-xs text-muted mt-0.5">
              {clientName ? <>Model portfolios for <span className="text-zinc-300">{clientName}</span> · shared across all interactions</> : 'Shared model portfolios for this client'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted hover:text-white hover:bg-zinc-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="relative z-10 flex-1 min-h-0 p-5 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-xs text-red-400">{loadError}</p>
            </div>
          ) : (
            <ClientModelsEditor models={seed} onChange={setDraft} />
          )}
        </div>

        {/* Footer */}
        <div className="relative z-10 flex-shrink-0 px-5 py-4 border-t border-zinc-800/50 flex items-center justify-between gap-3">
          <div>{saveError && <p className="text-xs text-red-400">{saveError}</p>}</div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-white transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading || saving || !!loadError}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all ${
                loading || saving || loadError
                  ? 'bg-zinc-800 text-muted cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:from-blue-500 hover:to-cyan-400'
              }`}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Briefcase className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save Models'}
            </button>
          </div>
        </div>
        <ResizeHandle startResize={startResize} resetSize={resetSize} />
      </div>
    </div>
  );
};

export default PortfolioModal;
