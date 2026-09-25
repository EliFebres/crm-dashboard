import type { NnaAllocation } from '@/app/lib/types/engagements';
import type { TickerNnaData, TickerNnaRow } from '@/app/lib/api/kpi';

// Shared NNA helpers used by the NNA modal (client) and the engagement routes
// (server). engagements.nna is the total; nna_allocations is an optional
// per-ticker breakdown of it and nna_notes optional rich-text notes.

export const MAX_NNA_ALLOCATIONS = 50;

// What the NNA modal saves: the total, its breakdown ([] = none), and notes.
export interface NnaUpdate {
  nna: number | undefined;
  allocations: NnaAllocation[];
  notes: string | null;
}

// Parse a user-typed amount to whole dollars. Accepts commas, spaces, a leading
// $, and K/M/B suffixes ("50M", "1.5B", "500,000"). Returns undefined if blank or invalid.
export function parseNNAInput(input: string): number | undefined {
  if (!input.trim()) return undefined;

  let cleaned = input.replace(/,/g, '').replace(/\s/g, '').toUpperCase();
  if (cleaned.startsWith('$')) cleaned = cleaned.substring(1);

  let multiplier = 1;
  if (cleaned.endsWith('M')) {
    multiplier = 1_000_000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('B')) {
    multiplier = 1_000_000_000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('K')) {
    multiplier = 1_000;
    cleaned = cleaned.slice(0, -1);
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return undefined;
  return Math.round(num * multiplier);
}

// Compact display: $1.5B, $50.0M, $500K, or the exact figure below $1K.
export function formatNNA(value: number | undefined | null): string {
  if (!value || value === 0) return '—';
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

// True when rich-text HTML has no visible text (e.g. the editor's empty "<p></p>").
export function isBlankRichText(html: string | null | undefined): boolean {
  if (!html) return true;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length === 0;
}

export function sumAllocations(allocations: NnaAllocation[]): number {
  return allocations.reduce((sum, a) => sum + a.amount, 0);
}

// Read a stored nna_allocations column defensively: a malformed value yields
// undefined rather than throwing, so one bad row can't break a whole list.
export function parseStoredAllocations(raw: unknown): NnaAllocation[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const valid = parsed.filter(
      (a): a is NnaAllocation =>
        !!a && typeof a.ticker === 'string' && typeof a.amount === 'number' && isFinite(a.amount),
    );
    return valid.length ? valid : undefined;
  } catch {
    return undefined;
  }
}

export interface NnaDetailsInput {
  nna: unknown;
  allocations?: unknown; // undefined = leave unchanged
  notes?: unknown;       // undefined = leave unchanged
}

export interface NnaDetails {
  nna: number | null;
  allocations: NnaAllocation[] | null | undefined; // undefined = leave unchanged
  notes: string | null | undefined;                // undefined = leave unchanged
}

export type NnaDetailsResult = { ok: true; value: NnaDetails } | { ok: false; error: string };

// Validate + normalize an NNA write. Rules:
//  - nna must be a non-negative finite number or null.
//  - tickers are trimmed + uppercased, non-empty, unique; amounts positive finite.
//  - the total may exceed the breakdown (the remainder is "unallocated") but may
//    not fall below it; with a breakdown and no total, the total becomes the sum.
//  - clearing the total (nna null, no breakdown given) clears breakdown + notes too.
//  - blank rich-text notes become null.
// `currentAllocations` is the stored breakdown, used to check the total when a
// caller changes only the total.
export function normalizeNnaDetails(
  input: NnaDetailsInput,
  currentAllocations?: NnaAllocation[] | null,
): NnaDetailsResult {
  let nna: number | null = null;
  if (input.nna !== null && input.nna !== undefined) {
    if (typeof input.nna !== 'number' || !isFinite(input.nna) || input.nna < 0) {
      return { ok: false, error: 'NNA must be a non-negative number' };
    }
    nna = Math.round(input.nna);
  }

  let allocations: NnaAllocation[] | null | undefined = undefined;
  if (input.allocations !== undefined) {
    if (input.allocations === null) {
      allocations = null;
    } else if (!Array.isArray(input.allocations)) {
      return { ok: false, error: 'NNA allocations must be an array' };
    } else {
      if (input.allocations.length > MAX_NNA_ALLOCATIONS) {
        return { ok: false, error: `At most ${MAX_NNA_ALLOCATIONS} tickers are allowed` };
      }
      const seen = new Set<string>();
      const list: NnaAllocation[] = [];
      for (const raw of input.allocations as unknown[]) {
        const r = raw as { ticker?: unknown; amount?: unknown } | null;
        const ticker = typeof r?.ticker === 'string' ? r.ticker.trim().toUpperCase() : '';
        if (!ticker) return { ok: false, error: 'Every allocation needs a ticker' };
        if (ticker.length > 20) return { ok: false, error: `Ticker "${ticker}" is too long` };
        const amount = r?.amount;
        if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
          return { ok: false, error: `Amount for ${ticker} must be a positive number` };
        }
        if (seen.has(ticker)) return { ok: false, error: `Ticker ${ticker} is listed twice` };
        seen.add(ticker);
        list.push({ ticker, amount: Math.round(amount) });
      }
      allocations = list.length ? list : null;
    }
  }

  let notes: string | null | undefined = undefined;
  if (input.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== 'string') {
      return { ok: false, error: 'NNA notes must be text' };
    }
    notes = isBlankRichText(input.notes as string | null) ? null : (input.notes as string);
  }

  // Clearing the total with no breakdown supplied wipes the detail with it — a
  // breakdown or notes without a total would be orphaned.
  if (nna === null && !allocations) {
    return { ok: true, value: { nna: null, allocations: null, notes: null } };
  }

  const effectiveAllocations = allocations !== undefined ? allocations : currentAllocations ?? null;
  if (effectiveAllocations && effectiveAllocations.length) {
    const sum = sumAllocations(effectiveAllocations);
    if (nna === null) {
      nna = sum;
    } else if (nna < sum) {
      return { ok: false, error: 'Total NNA cannot be less than the sum of the ticker amounts' };
    }
  }

  return { ok: true, value: { nna, allocations, notes } };
}

export const UNALLOCATED_TICKER = 'Unallocated';

export interface TickerNnaSource {
  nna: number;
  allocations: NnaAllocation[] | undefined;
  type: string;
  dept: string;
}

// Roll engagements up into NNA per ticker. Each allocation credits its ticker;
// whatever of an engagement's total the breakdown doesn't cover (all of it, when
// there is no breakdown) goes to 'Unallocated'. Every row is also split by the
// engagement's project type and client department, so the tickers plus
// Unallocated always sum to the total.
export function rollUpTickerNna(
  sources: TickerNnaSource[],
): Omit<TickerNnaData, 'typeColors' | 'deptColors'> {
  const newRow = (ticker: string): TickerNnaRow => ({
    ticker, nna: 0, engagements: 0, share: 0, byType: {}, byDept: {},
  });
  const credit = (row: TickerNnaRow, amount: number, src: TickerNnaSource) => {
    row.nna += amount;
    row.engagements += 1;
    row.byType[src.type] = (row.byType[src.type] ?? 0) + amount;
    row.byDept[src.dept] = (row.byDept[src.dept] ?? 0) + amount;
  };

  const byTicker = new Map<string, TickerNnaRow>();
  const unallocated = newRow(UNALLOCATED_TICKER);
  let totalNna = 0;

  for (const src of sources) {
    if (!(src.nna > 0)) continue;
    totalNna += src.nna;
    const allocations = (src.allocations ?? []).filter(a => a.amount > 0);
    for (const a of allocations) {
      const ticker = a.ticker.trim().toUpperCase();
      let row = byTicker.get(ticker);
      if (!row) byTicker.set(ticker, (row = newRow(ticker)));
      credit(row, a.amount, src);
    }
    const remainder = Math.max(0, src.nna - sumAllocations(allocations));
    if (remainder > 0) credit(unallocated, remainder, src);
  }

  const share = (n: number) => (totalNna > 0 ? (n / totalNna) * 100 : 0);
  const tickers = [...byTicker.values()].sort((a, b) => b.nna - a.nna);
  for (const row of tickers) row.share = share(row.nna);
  unallocated.share = share(unallocated.nna);

  return {
    totalNna,
    allocatedPct: totalNna > 0 ? 100 - unallocated.share : 0,
    tickers,
    unallocated,
  };
}
