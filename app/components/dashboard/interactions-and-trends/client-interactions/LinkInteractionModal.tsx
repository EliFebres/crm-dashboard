'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Link2 } from 'lucide-react';
import { searchEngagementsForLink } from '@/app/lib/api/client-interactions';
import type { EngagementLinkSummary } from '@/app/lib/types/engagements';
import { useResizableModal } from '@/app/lib/hooks/useResizableModal';
import { ResizeHandle } from '@/app/components/ui/ResizeHandle';

interface LinkInteractionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (summary: EngagementLinkSummary) => void;
  // When provided, results default to this internal client (the common KPI-funnel case)
  defaultClient?: string;
  // The current engagement id (when editing) — excluded from results to prevent self-link
  excludeId?: number;
}

export default function LinkInteractionModal({
  isOpen,
  onClose,
  onSelect,
  defaultClient,
  excludeId,
}: LinkInteractionModalProps) {
  const [query, setQuery] = useState('');
  const [allClients, setAllClients] = useState(false); // toggle to search beyond defaultClient
  const [results, setResults] = useState<EngagementLinkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { panelRef, panelStyle, startResize, resetSize } = useResizableModal('link-interaction');

  // Reset state each time the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setAllClients(false);
    setResults([]);
    // Focus search after a tick so the modal transition doesn't steal focus
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isOpen]);

  // Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Debounced search — refetches whenever query / scope toggle changes
  useEffect(() => {
    if (!isOpen) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchEngagementsForLink({
          q: query.trim() || undefined,
          client: !allClients && defaultClient ? defaultClient : undefined,
          excludeId,
          limit: 20,
        });
        setResults(rows);
      } catch (err) {
        console.error('Link search failed:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [isOpen, query, allClients, defaultClient, excludeId]);

  if (!isOpen) return null;

  const scopeLabel = !allClients && defaultClient
    ? `Same client: ${defaultClient}`
    : 'All interactions';

  return (
    <>
      <div
        className="fixed inset-0 z-[110] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-8 pointer-events-none">
        <div ref={panelRef} style={panelStyle} className="relative w-full max-w-xl max-h-[80vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl pointer-events-auto overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-cyan-400" />
              <div>
                <h2 className="text-lg font-semibold text-white">Link a previous interaction</h2>
                <p className="text-xs text-muted">Pick the engagement this one was the result of</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-muted hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search + scope toggle */}
          <div className="px-6 py-3 border-b border-zinc-800 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by client, project type, intake type, or id..."
                className="w-full pl-9 pr-3 py-2 bg-zinc-800/50 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 text-sm"
              />
            </div>
            {defaultClient && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">{scopeLabel}</span>
                <button
                  type="button"
                  onClick={() => setAllClients((v) => !v)}
                  className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  {allClients ? 'Limit to same client' : 'Search all interactions'}
                </button>
              </div>
            )}
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 text-muted animate-spin" />
              </div>
            ) : results.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted px-6">
                {query.trim() || (!allClients && defaultClient)
                  ? 'No matching interactions found.'
                  : 'Start typing to search for a previous interaction.'}
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(r);
                        onClose();
                      }}
                      className="w-full text-left px-6 py-3 hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm text-white truncate">
                            <span className="font-medium">{r.type}</span>
                            <span className="text-zinc-600">·</span>
                            <span className="text-muted">{r.intakeType}</span>
                          </div>
                          <div className="text-xs text-muted truncate mt-0.5">
                            {r.internalClientName} ({r.internalClientDept})
                            {r.externalClient ? <span> · {r.externalClient}</span> : null}
                          </div>
                        </div>
                        <div className="text-xs text-muted flex-shrink-0">
                          {r.dateStarted}
                          <span className="ml-2 text-zinc-600">#{r.id}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <ResizeHandle startResize={startResize} resetSize={resetSize} />
        </div>
      </div>
    </>
  );
}
