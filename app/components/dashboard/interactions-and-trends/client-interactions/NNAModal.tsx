'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, DollarSign, Plus, Trash2 } from 'lucide-react';
import type { NnaAllocation } from '@/app/lib/types/engagements';
import {
  parseNNAInput,
  formatNNA,
  isBlankRichText,
  sumAllocations,
  MAX_NNA_ALLOCATIONS,
  type NnaUpdate,
} from '@/app/lib/nna';
import RichTextEditor from '@/app/components/dashboard/shared/RichTextEditor';

interface NNAModalProps {
  isOpen: boolean;
  onClose: () => void;
  engagementId: number;
  externalClient: string | null;
  internalClient: string;
  currentNNA: number | undefined;
  currentAllocations?: NnaAllocation[];
  currentNotes?: string | null;
  onSave: (engagementId: number, update: NnaUpdate) => void;
}

interface TickerRow {
  key: number;
  ticker: string;
  amountInput: string;
}

// Outer wrapper keeps the body unmounted while closed — so each reopen is a
// fresh mount and state initializes lazily from the current prop snapshot.
const NNAModal: React.FC<NNAModalProps> = (props) => {
  if (!props.isOpen) return null;
  return <NNAModalBody {...props} />;
};

const inputClass =
  'w-full py-2 bg-zinc-800/50 border border-zinc-700/50 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors font-mono';

// Rewrite shorthand ("50M", "$1.5b") as the exact figure ("50,000,000") once the
// user leaves the field. Unparseable input is left as typed so it can be fixed.
const expandAmount = (input: string): string => {
  const parsed = parseNNAInput(input);
  return parsed === undefined ? input : parsed.toLocaleString('en-US');
};

const NNAModalBody: React.FC<NNAModalProps> = ({
  onClose,
  engagementId,
  externalClient,
  internalClient,
  currentNNA,
  currentAllocations,
  currentNotes,
  onSave,
}) => {
  const initialAllocations = currentAllocations ?? [];
  const nextKeyRef = useRef(initialAllocations.length);
  const [rows, setRows] = useState<TickerRow[]>(() =>
    initialAllocations.map((a, i) => ({ key: i, ticker: a.ticker, amountInput: a.amount.toLocaleString('en-US') }))
  );
  // Auto-sum: until the user types their own total, the total follows the sum of
  // the ticker rows. An existing total that differs from its breakdown (or has no
  // breakdown) counts as user-entered, so adding rows never overwrites it.
  const [totalTouched, setTotalTouched] = useState(
    () => currentNNA != null && currentNNA !== sumAllocations(initialAllocations)
  );
  const [totalInput, setTotalInput] = useState(() =>
    currentNNA ? currentNNA.toLocaleString('en-US') : ''
  );
  const [notes, setNotes] = useState(currentNotes ?? '');
  const [focusRowKey, setFocusRowKey] = useState<number | null>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const tickerRefs = useRef(new Map<number, HTMLInputElement>());

  // Focus the total on mount (i.e. when the modal opens)
  useEffect(() => {
    totalRef.current?.focus();
    totalRef.current?.select();
  }, []);

  // Focus a freshly added row's ticker input
  useEffect(() => {
    if (focusRowKey == null) return;
    tickerRefs.current.get(focusRowKey)?.focus();
  }, [focusRowKey]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // --- Derived state --------------------------------------------------------
  const parsedRows = rows.map(r => {
    const ticker = r.ticker.trim().toUpperCase();
    const amount = parseNNAInput(r.amountInput);
    const blank = !ticker && !r.amountInput.trim();
    const amountValid = amount !== undefined && amount > 0;
    return { ...r, ticker, amount, blank, complete: !!ticker && amountValid, amountValid };
  });
  const allocations: NnaAllocation[] = parsedRows
    .filter(r => r.complete)
    .map(r => ({ ticker: r.ticker, amount: r.amount! }));
  const allocatedSum = sumAllocations(allocations);

  const totalDisplay = totalTouched ? totalInput : (allocatedSum ? allocatedSum.toLocaleString('en-US') : '');
  const parsedTotal = totalTouched ? parseNNAInput(totalInput) : (allocatedSum || undefined);
  const unallocated = parsedTotal !== undefined ? parsedTotal - allocatedSum : 0;

  const tickerCounts = new Map<string, number>();
  for (const r of parsedRows) if (r.ticker) tickerCounts.set(r.ticker, (tickerCounts.get(r.ticker) ?? 0) + 1);
  const duplicateTicker = [...tickerCounts].find(([, n]) => n > 1)?.[0];

  const normalizedNotes = isBlankRichText(notes) ? null : notes;

  let error: string | null = null;
  if (totalTouched && totalInput.trim() && parsedTotal === undefined) {
    error = 'Enter a valid total amount.';
  } else if (parsedRows.some(r => !r.blank && !r.complete)) {
    error = 'Each ticker row needs a ticker and an amount greater than zero.';
  } else if (duplicateTicker) {
    error = `${duplicateTicker} is listed more than once.`;
  } else if (parsedTotal !== undefined && parsedTotal < allocatedSum) {
    error = 'Total NNA is less than the sum of the ticker amounts.';
  } else if (parsedTotal === undefined && normalizedNotes) {
    error = 'Enter an NNA amount to save notes.';
  }

  const initialNotes = isBlankRichText(currentNotes) ? null : currentNotes ?? null;
  const hasChanges =
    parsedTotal !== currentNNA ||
    JSON.stringify(allocations) !== JSON.stringify(initialAllocations) ||
    normalizedNotes !== initialNotes;
  const canSave = hasChanges && !error;
  const hasExisting = !!currentNNA || initialAllocations.length > 0 || !!initialNotes;

  // --- Handlers -------------------------------------------------------------
  const handleTotalChange = (value: string) => {
    // Emptying the total hands it back to the auto-sum.
    if (!value.trim()) {
      setTotalTouched(false);
      setTotalInput('');
    } else {
      setTotalTouched(true);
      setTotalInput(value);
    }
  };

  const addRow = () => {
    if (rows.length >= MAX_NNA_ALLOCATIONS) return;
    const key = nextKeyRef.current++;
    setRows(prev => [...prev, { key, ticker: '', amountInput: '' }]);
    setFocusRowKey(key);
  };

  const updateRow = (key: number, patch: Partial<TickerRow>) => {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: number) => {
    setRows(prev => prev.filter(r => r.key !== key));
    tickerRefs.current.delete(key);
  };

  const handleSave = () => {
    if (!canSave) return;
    onSave(engagementId, { nna: parsedTotal, allocations, notes: normalizedNotes });
    onClose();
  };

  const handleClear = () => {
    onSave(engagementId, { nna: undefined, allocations: [], notes: null });
    onClose();
  };

  const clientDisplay = externalClient || internalClient;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-xl max-h-[85vh] bg-zinc-900 border border-zinc-700/50 shadow-2xl flex flex-col">
        {/* Gradient border effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />

        {/* Header */}
        <div className="relative z-10 px-5 py-4 border-b border-zinc-800/50 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-base font-medium text-white">Net New Assets</h2>
            <p className="text-xs text-muted mt-0.5">{clientDisplay}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="relative z-10 p-5 space-y-6 overflow-y-auto min-h-0 flex-1">
          {/* Total */}
          <section>
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Total NNA
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
              <input
                ref={totalRef}
                type="text"
                value={totalDisplay}
                onChange={(e) => handleTotalChange(e.target.value)}
                onBlur={() => {
                  if (totalTouched) setTotalInput(expandAmount(totalInput));
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                placeholder="e.g., 50M, 1.5B, 500000"
                className={`${inputClass} pl-9 pr-3 ${totalTouched && totalInput.trim() && parsedTotal === undefined ? '!border-red-500/60' : ''}`}
              />
            </div>
            {allocations.length > 0 ? (
              <p className="mt-2 text-xs text-muted">
                {!totalTouched && <span className="text-emerald-400/80">Auto-summed from tickers · </span>}
                Allocated <span className="font-mono text-zinc-300">{formatNNA(allocatedSum)}</span>
                {parsedTotal !== undefined && (
                  unallocated >= 0 ? (
                    <> · Unallocated <span className="font-mono text-zinc-300">{unallocated ? formatNNA(unallocated) : '$0'}</span></>
                  ) : (
                    <> · <span className="text-red-400">Over by <span className="font-mono">{formatNNA(-unallocated)}</span></span></>
                  )
                )}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Supports 50M, 1.5B, 500K, or exact numbers like 50,000,000
              </p>
            )}
          </section>

          {/* Ticker breakdown */}
          <section>
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Ticker Breakdown <span className="normal-case tracking-normal font-normal">(optional)</span>
            </label>
            {parsedRows.length > 0 && (
              <div className="space-y-2 mb-2">
                {parsedRows.map((row, idx) => {
                  const isDuplicate = !!row.ticker && (tickerCounts.get(row.ticker) ?? 0) > 1;
                  const amountBad = !row.blank && !!row.amountInput.trim() && !row.amountValid;
                  return (
                    <div key={row.key} className="flex items-center gap-2">
                      <input
                        ref={(el) => {
                          if (el) tickerRefs.current.set(row.key, el);
                          else tickerRefs.current.delete(row.key);
                        }}
                        type="text"
                        value={rows[idx].ticker}
                        onChange={(e) => updateRow(row.key, { ticker: e.target.value.toUpperCase() })}
                        placeholder="Ticker"
                        maxLength={20}
                        aria-label="Ticker"
                        className={`${inputClass} !w-28 px-3 uppercase ${isDuplicate ? '!border-red-500/60' : ''}`}
                      />
                      <div className="relative flex-1">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted" />
                        <input
                          type="text"
                          value={rows[idx].amountInput}
                          onChange={(e) => updateRow(row.key, { amountInput: e.target.value })}
                          onBlur={() => updateRow(row.key, { amountInput: expandAmount(rows[idx].amountInput) })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && idx === rows.length - 1) {
                              e.preventDefault();
                              addRow();
                            }
                          }}
                          placeholder="Amount"
                          aria-label={`Amount for ${row.ticker || 'ticker'}`}
                          className={`${inputClass} pl-8 pr-3 ${amountBad ? '!border-red-500/60' : ''}`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        className="p-1.5 text-muted hover:text-red-400 transition-colors"
                        title="Remove ticker"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={addRow}
              disabled={rows.length >= MAX_NNA_ALLOCATIONS}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs text-muted hover:text-emerald-400 border border-dashed border-zinc-700 hover:border-emerald-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              Add ticker
            </button>
          </section>

          {/* Notes */}
          <section>
            <label className="block text-xs font-medium text-muted uppercase tracking-wider mb-2">
              Notes <span className="normal-case tracking-normal font-normal">(optional)</span>
            </label>
            <RichTextEditor
              value={notes}
              onChange={setNotes}
              placeholder="Add context about this NNA..."
              minHeight="4.5rem"
              maxHeight="25vh"
            />
          </section>
        </div>

        {/* Footer */}
        <div className="relative z-10 px-5 py-4 border-t border-zinc-800/50 flex-shrink-0">
          {error && (
            <p className="mb-3 text-xs text-red-400">{error}</p>
          )}
          <div className="flex items-center justify-between">
            <div>
              {hasExisting && (
                <button
                  onClick={handleClear}
                  className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                >
                  Clear NNA
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-muted hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!canSave}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all ${
                  canSave
                    ? 'bg-gradient-to-r from-emerald-600 to-cyan-500 text-white hover:from-emerald-500 hover:to-cyan-400'
                    : 'bg-zinc-800 text-muted cursor-not-allowed'
                }`}
              >
                <DollarSign className="w-4 h-4" />
                Save NNA
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NNAModal;
