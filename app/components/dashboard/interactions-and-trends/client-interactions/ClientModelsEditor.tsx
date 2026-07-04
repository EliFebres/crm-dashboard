'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Check, ClipboardPaste, Download, Briefcase } from 'lucide-react';
import type { AssetClass, ConstituentType, ClientModel, PortfolioHolding } from '@/app/lib/types/engagements';
import {
  ASSET_CLASSES, CONSTITUENT_TYPES, parseAssetClass, parseConstituentType, normalizeHoldingWeights,
} from '@/app/lib/utils/portfolioHoldings';

// ── Internal editable shapes ────────────────────────────────────────────────
// Weights/AUM are kept as strings while editing (so partial input like "10." is
// allowed); they're normalized to typed values on emit.
interface EditableHolding {
  id: string;
  identifier: string;
  constituentType: ConstituentType | '';
  assetClass: AssetClass | '';
  weight: string;
}
interface EditableModel {
  id: string;
  name: string;
  isMain: boolean;
  aum: string;       // free-form, accepts shorthand like "200M"
  holdings: EditableHolding[];
}

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
};

const createEmptyRow = (): EditableHolding => ({
  id: generateId(), identifier: '', constituentType: '', assetClass: '', weight: '',
});

// Format a dollar amount for compact display (mirrors the interaction form's NNA style).
const formatAum = (value: number): string => {
  if (!value) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

// Parse an AUM input that accepts plain numbers or K/M/B shorthand ("200M", "1.5b").
const parseAumInput = (raw: string): number | null => {
  const s = raw.trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  const m = s.match(/^([0-9]*\.?[0-9]+)([kmb])?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix === 'k') n *= 1_000;
  else if (suffix === 'm') n *= 1_000_000;
  else if (suffix === 'b') n *= 1_000_000_000;
  return Math.round(n);
};

// ── prop → editable seeding ─────────────────────────────────────────────────
const holdingToEditable = (h: PortfolioHolding): EditableHolding => ({
  id: generateId(),
  identifier: h.identifier,
  constituentType: h.constituentType,
  assetClass: h.assetClass,
  weight: (h.weight * 100).toFixed(2),
});

const modelToEditable = (m: ClientModel): EditableModel => ({
  id: m.id || generateId(),
  name: m.name,
  isMain: m.isMain,
  aum: m.aum != null ? String(m.aum) : '',
  holdings: m.holdings.length > 0 ? [...m.holdings.map(holdingToEditable), createEmptyRow()] : [createEmptyRow()],
});

// Convert an editable holding row to a typed holding (or null if incomplete).
const editableToHolding = (h: EditableHolding): PortfolioHolding | null => {
  if (!h.identifier.trim() || !h.constituentType || !h.assetClass || !h.weight.trim()) return null;
  const weight = parseFloat(h.weight);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  return {
    identifier: h.identifier.trim().toUpperCase(),
    constituentType: h.constituentType,
    assetClass: h.assetClass,
    weight, // raw percent; normalized below
  };
};

// Normalize an editable model set into the canonical ClientModel[] shape.
const toClientModels = (models: EditableModel[]): ClientModel[] =>
  models.map((m, i) => {
    const typed = m.holdings.map(editableToHolding).filter((h): h is PortfolioHolding => h !== null);
    const aum = parseAumInput(m.aum);
    return {
      id: m.id,
      name: m.name.trim(),
      isMain: m.isMain,
      ...(aum != null ? { aum } : {}),
      holdings: normalizeHoldingWeights(typed),
      sortOrder: i,
    };
  });

interface ClientModelsEditorProps {
  /** Seed data — read once on mount; subsequent edits are emitted via onChange. */
  models: ClientModel[];
  /** Emits the normalized model set on every edit (parent persists it). */
  onChange: (models: ClientModel[]) => void;
}

const ClientModelsEditor: React.FC<ClientModelsEditorProps> = ({ models: seed, onChange }) => {
  const [models, setModels] = useState<EditableModel[]>(() =>
    seed.length > 0 ? seed.map(modelToEditable) : [{ id: generateId(), name: 'Main Model', isMain: true, aum: '', holdings: [createEmptyRow()] }]
  );
  const [selectedId, setSelectedId] = useState<string>(() =>
    (seed.find(m => m.isMain)?.id) || seed[0]?.id || ''
  );
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Sync the parent with the seeded set on mount, so a save with no edits still
  // reflects what's shown (e.g. the default "Main Model" for a client with none).
  useEffect(() => { onChange(toClientModels(models)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Single write path: mutate editable models, then emit normalized set upward.
  const commit = useCallback((next: EditableModel[]) => {
    setModels(next);
    onChange(toClientModels(next));
  }, [onChange]);

  const selected = models.find(m => m.id === selectedId) ?? models[0];

  const patchSelected = (patch: Partial<EditableModel>) => {
    commit(models.map(m => (m.id === selected.id ? { ...m, ...patch } : m)));
  };

  const addModel = () => {
    const m: EditableModel = {
      id: generateId(),
      name: `Model ${models.length + 1}`,
      isMain: models.length === 0,
      aum: '',
      holdings: [createEmptyRow()],
    };
    const next = [...models, m];
    setModels(next);
    setSelectedId(m.id);
    onChange(toClientModels(next));
  };

  const removeModel = (id: string) => {
    let next = models.filter(m => m.id !== id);
    // Keep exactly one main alive.
    if (next.length > 0 && !next.some(m => m.isMain)) next = next.map((m, i) => (i === 0 ? { ...m, isMain: true } : m));
    setModels(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? '');
    onChange(toClientModels(next));
  };

  const setMain = (id: string) => {
    commit(models.map(m => ({ ...m, isMain: m.id === id })));
  };

  // ── holdings-grid handlers (operate on the selected model) ─────────────────
  const updateHolding = (holdingId: string, field: keyof EditableHolding, value: string) => {
    const updated = selected.holdings.map(h => (h.id === holdingId ? { ...h, [field]: value } : h));
    const last = updated[updated.length - 1];
    const lastComplete = last.identifier.trim() && last.constituentType && last.assetClass && last.weight.trim();
    patchSelected({ holdings: lastComplete ? [...updated, createEmptyRow()] : updated });
  };
  const addRow = () => patchSelected({ holdings: [...selected.holdings, createEmptyRow()] });
  const removeRow = (holdingId: string) => {
    const filtered = selected.holdings.filter(h => h.id !== holdingId);
    patchSelected({ holdings: filtered.length === 0 ? [createEmptyRow()] : filtered });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text');
    if (!pastedText.trim()) return;
    const delimiter = pastedText.includes('\t') ? '\t' : ',';
    const lines = pastedText.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return;
    e.preventDefault();
    setPasteError(null);

    const parsed: EditableHolding[] = [];
    const errors: string[] = [];
    lines.forEach((line, index) => {
      const parts = line.split(delimiter).map(p => p.trim());
      const identifier = parts[0] || '';
      const constituentTypeStr = parts[1] || '';
      const assetClassStr = parts[2] || '';
      const weightStr = parts[3] || '';
      const constituentType = parseConstituentType(constituentTypeStr);
      const assetClass = parseAssetClass(assetClassStr);
      if (constituentTypeStr && !constituentType) errors.push(`Row ${index + 1}: Unknown constituent type "${constituentTypeStr}"`);
      if (assetClassStr && !assetClass) errors.push(`Row ${index + 1}: Unknown asset class "${assetClassStr}"`);
      parsed.push({ id: generateId(), identifier, constituentType, assetClass, weight: weightStr.replace('%', '').trim() });
    });

    if (parsed.length > 0) {
      const current = selected.holdings;
      const onlyEmpty = current.length === 1 && !current[0].identifier && !current[0].weight;
      patchSelected({ holdings: onlyEmpty ? parsed : [...current, ...parsed] });
    }
    if (errors.length > 0) setPasteError(errors.join('; '));
  };

  const previewNormalized = normalizeHoldingWeights(
    selected.holdings.map(editableToHolding).filter((h): h is PortfolioHolding => h !== null)
  );

  return (
    <div className="flex gap-4 min-h-[420px]">
      {/* Left rail: model list */}
      <div className="w-52 flex-shrink-0 flex flex-col gap-1.5">
        {models.map(m => {
          const isSel = m.id === selected?.id;
          const aum = parseAumInput(m.aum);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelectedId(m.id)}
              className={`group text-left px-3 py-2 rounded-lg border transition-colors ${
                isSel ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-zinc-700/50 bg-zinc-800/40 hover:border-zinc-600'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-sm truncate ${isSel ? 'text-white' : 'text-zinc-300'}`}>{m.name || 'Untitled model'}</span>
                {m.isMain && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                    Main
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted mt-0.5">{aum != null ? formatAum(aum) : 'AUM —'}</div>
            </button>
          );
        })}
        <button
          type="button"
          onClick={addModel}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-cyan-400 hover:text-cyan-300 border border-dashed border-zinc-700/60 rounded-lg hover:border-cyan-500/40 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add model
        </button>
      </div>

      {/* Right pane: selected model editor */}
      {selected && (
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          {/* Name + main + AUM + delete */}
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-[11px] font-medium text-muted uppercase tracking-wider mb-1">Model name</label>
              <input
                type="text"
                value={selected.name}
                onChange={(e) => patchSelected({ name: e.target.value })}
                placeholder="e.g. 60/40 Model"
                className="w-full px-2.5 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50"
              />
            </div>
            <div className="w-28">
              <label className="block text-[11px] font-medium text-muted uppercase tracking-wider mb-1">AUM</label>
              <input
                type="text"
                value={selected.aum}
                onChange={(e) => patchSelected({ aum: e.target.value })}
                placeholder="e.g. 200M"
                title="Optional. Accepts shorthand like 200M or 1.5B."
                className="w-full px-2.5 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50 font-mono text-left"
              />
            </div>
            <button
              type="button"
              onClick={() => setMain(selected.id)}
              title={selected.isMain ? 'This is the main model' : 'Set as the main model'}
              className={`h-[34px] px-2.5 rounded border text-xs flex items-center gap-1 transition-colors ${
                selected.isMain
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                  : 'border-zinc-700/50 text-muted hover:border-cyan-500/40 hover:text-cyan-400'
              }`}
            >
              {selected.isMain && <Check className="w-3.5 h-3.5" />}
              {selected.isMain ? 'Main model' : 'Set as main'}
            </button>
            <button
              type="button"
              onClick={() => removeModel(selected.id)}
              disabled={models.length <= 1}
              title={models.length <= 1 ? 'A client keeps at least one model' : 'Delete this model'}
              className="h-[34px] px-2.5 rounded border border-zinc-700/50 text-muted hover:text-red-400 hover:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          {/* Paste hint */}
          <div className="p-2.5 bg-zinc-800/30 border border-zinc-700/30 rounded-lg flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <ClipboardPaste className="w-3.5 h-3.5 flex-shrink-0" />
              <span>Paste from Excel: Identifier, Constituent Type, Asset Class, Weight</span>
            </div>
            <a
              href="/api/client-interactions/engagements/portfolio-template"
              download
              className="flex-shrink-0 flex items-center gap-1 text-[11px] text-muted hover:text-cyan-400 transition-colors"
            >
              <Download className="w-3 h-3" /> Template
            </a>
          </div>

          {pasteError && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg">
              <p className="text-[11px] text-red-400">{pasteError}</p>
            </div>
          )}

          {/* Holdings grid */}
          <div className="border border-zinc-700/50 rounded-lg overflow-hidden" onPaste={handlePaste}>
            <div className="grid grid-cols-[1fr_1fr_1fr_90px_36px] gap-2 px-3 py-2 bg-zinc-800/50 border-b border-zinc-700/50">
              <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Identifier</div>
              <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Constituent</div>
              <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Asset Class</div>
              <div className="text-[11px] font-medium text-muted uppercase tracking-wider">Weight</div>
              <div />
            </div>
            <div className="divide-y divide-zinc-800/50 max-h-[240px] overflow-y-auto">
              {selected.holdings.map(h => (
                <div key={h.id} className="grid grid-cols-[1fr_1fr_1fr_90px_36px] gap-2 px-3 py-2 items-center">
                  <input
                    type="text"
                    value={h.identifier}
                    onChange={(e) => updateHolding(h.id, 'identifier', e.target.value.toUpperCase())}
                    placeholder="AAPL…"
                    className="w-full px-2 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 font-mono"
                  />
                  <select
                    value={h.constituentType}
                    onChange={(e) => updateHolding(h.id, 'constituentType', e.target.value)}
                    className="w-full px-2 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50 appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-zinc-800">Select…</option>
                    {CONSTITUENT_TYPES.map(ct => <option key={ct} value={ct} className="bg-zinc-800">{ct}</option>)}
                  </select>
                  <select
                    value={h.assetClass}
                    onChange={(e) => updateHolding(h.id, 'assetClass', e.target.value)}
                    className="w-full px-2 py-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-cyan-500/50 appearance-none cursor-pointer"
                  >
                    <option value="" className="bg-zinc-800">Select…</option>
                    {ASSET_CLASSES.map(ac => <option key={ac} value={ac} className="bg-zinc-800">{ac}</option>)}
                  </select>
                  <div className="relative">
                    <input
                      type="text"
                      value={h.weight}
                      onChange={(e) => updateHolding(h.id, 'weight', e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="10"
                      className="w-full px-2 py-1.5 pr-5 bg-zinc-800/50 border border-zinc-700/50 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 text-right font-mono"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">%</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRow(h.id)}
                    className="p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-3 py-2 border-t border-zinc-700/50">
              <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors">
                <Plus className="w-3 h-3" /> Add row
              </button>
            </div>
          </div>

          {/* Normalized preview */}
          {previewNormalized.length > 0 && (
            <div className="p-2.5 bg-zinc-800/30 border border-zinc-700/30 rounded-lg">
              <p className="text-[11px] text-muted mb-1.5 flex items-center gap-1.5">
                <Briefcase className="w-3 h-3" /> Normalized (weights sum to 100%)
              </p>
              <div className="space-y-0.5 max-h-28 overflow-y-auto">
                {previewNormalized.map((h, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_70px] gap-2 text-xs">
                    <span className="font-mono text-white">{h.identifier}</span>
                    <span className="text-muted">{h.constituentType}</span>
                    <span className="text-muted">{h.assetClass}</span>
                    <span className="font-mono text-cyan-400 text-right">{(h.weight * 100).toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClientModelsEditor;
