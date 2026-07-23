'use client';

import { useEffect, useRef, useState } from 'react';
import { FLASH_CLASS, FLASH_TEXT_CLASS, type FlashKind } from './useDashboardChanges';

// Re-export the shared flash class maps so list components have a single import.
export { FLASH_CLASS, FLASH_TEXT_CLASS };
export type { FlashKind };

export interface FlashToken {
  kind: FlashKind;
  nonce: number;
}

export interface FieldSpec<T> {
  /** Stable key for this field, used to look up the flash on a cell. */
  key: string;
  /** Comparable value; a change between snapshots flashes the cell. */
  get: (row: T) => string | number | boolean | null | undefined;
  /** Flash color for a change — a constant or a fn of (prevValue, nextValue). Default 'neutral'. */
  kind?: FlashKind | ((prev: string, next: string) => FlashKind);
}

export interface RowFlashState {
  /** Ids present now but absent in the previous snapshot (flash the whole row). */
  newIds: Set<string>;
  /** rowId → fieldKey → token, for cell-level flashes. */
  cells: Map<string, Record<string, FlashToken>>;
}

interface RowDiff {
  newIds: Set<string>;
  cells: Map<string, Record<string, FlashToken>>;
}

const FLASH_MS = 1200;
const EMPTY: RowFlashState = { newIds: new Set(), cells: new Map() };

function computeRowDiff<T extends { id: string }>(
  prev: Map<string, T>,
  next: Map<string, T>,
  specs: FieldSpec<T>[],
  mkNonce: () => number,
): RowDiff {
  const newIds = new Set<string>();
  const cells = new Map<string, Record<string, FlashToken>>();

  for (const [id, row] of next) {
    const before = prev.get(id);
    if (!before) { newIds.add(id); continue; }
    const changed: Record<string, FlashToken> = {};
    for (const s of specs) {
      const a = String(s.get(before) ?? '');
      const b = String(s.get(row) ?? '');
      if (a === b) continue;
      const kind = typeof s.kind === 'function' ? s.kind(a, b) : (s.kind ?? 'neutral');
      changed[s.key] = { kind, nonce: mkNonce() };
    }
    if (Object.keys(changed).length) cells.set(id, changed);
  }

  return { newIds, cells };
}

function isEmptyDiff(d: RowDiff): boolean {
  return d.newIds.size === 0 && d.cells.size === 0;
}

function mergeRowFlashes(base: RowFlashState, add: RowDiff): RowFlashState {
  const cells = new Map(base.cells);
  for (const [id, tokens] of add.cells) {
    cells.set(id, { ...(cells.get(id) ?? {}), ...tokens });
  }
  return { newIds: new Set([...base.newIds, ...add.newIds]), cells };
}

// Remove the tokens scheduled by this cycle. New-row flags clear unconditionally
// (a row is "new" once); cell tokens clear only if a newer flash (different
// nonce) hasn't replaced them.
function pruneRowFlashes(current: RowFlashState, expired: RowDiff): RowFlashState {
  const newIds = new Set(current.newIds);
  for (const id of expired.newIds) newIds.delete(id);

  const cells = new Map(current.cells);
  for (const [id, expiredTokens] of expired.cells) {
    const cur = cells.get(id);
    if (!cur) continue;
    const kept: Record<string, FlashToken> = {};
    for (const [k, v] of Object.entries(cur)) {
      const exp = expiredTokens[k];
      if (!exp || exp.nonce !== v.nonce) kept[k] = v;
    }
    if (Object.keys(kept).length) cells.set(id, kept);
    else cells.delete(id);
  }

  return { newIds, cells };
}

/**
 * The keyed-list equivalent of {@link useDashboardChanges}: diffs consecutive
 * snapshots of `rows` and returns rolling "recently changed" flash tokens that
 * auto-expire after ~1.2s. Works the same whether a change came from an
 * optimistic local edit or an SSE-triggered refetch — it only compares values.
 *
 * The first snapshot is treated as a baseline (no flash). Pass `undefined` until
 * the first fetch resolves: an empty array is a valid snapshot of a genuinely
 * empty list, so `[]` would be taken as the baseline and the loaded rows would
 * then diff against it as brand new. `specs` must be a stable (module-level) array.
 */
export function useRowFlashes<T extends { id: string }>(
  /** The current rows, or `undefined` while no data has loaded yet. */
  rows: T[] | undefined,
  specs: FieldSpec<T>[],
): RowFlashState {
  const prevRef = useRef<Map<string, T> | null>(null);
  const nonceRef = useRef(0);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [state, setState] = useState<RowFlashState>(EMPTY);

  useEffect(() => {
    if (!rows) return;
    const next = new Map(rows.map(r => [r.id, r]));
    const prev = prevRef.current;

    if (!prev) {
      prevRef.current = next; // baseline — never flash the first paint
      return;
    }

    const diff = computeRowDiff(prev, next, specs, () => ++nonceRef.current);
    prevRef.current = next;

    if (isEmptyDiff(diff)) return;

    setState(cur => mergeRowFlashes(cur, diff));

    const timer = setTimeout(() => {
      setState(cur => pruneRowFlashes(cur, diff));
      timersRef.current.delete(timer);
    }, FLASH_MS);
    timersRef.current.add(timer);
  }, [rows, specs]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(t => clearTimeout(t));
      timers.clear();
    };
  }, []);

  return state;
}
