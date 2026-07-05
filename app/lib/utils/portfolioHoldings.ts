/**
 * Shared portfolio-holding helpers — the canonical asset-class / constituent-type
 * vocabularies plus parsing and weight normalization. Extracted so the interactive
 * editor (ClientModelsEditor) and the server (replaceClientModels) agree on shape.
 */
import type { AssetClass, ConstituentType, PortfolioHolding } from '@/app/lib/types/engagements';

export const ASSET_CLASSES: AssetClass[] = ['Equity', 'Fixed Income', 'Alternatives', 'Crypto', 'Fund of Funds', 'Multi-Asset'];
export const CONSTITUENT_TYPES: ConstituentType[] = ['Portfolio', 'Morningstar-Fund', 'Security', 'Index'];

/** Parse a loose constituent-type string (e.g. from an Excel paste) into a canonical value. */
export function parseConstituentType(value: string): ConstituentType | '' {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  if (normalized === 'portfolio') return 'Portfolio';
  if (normalized === 'morningstar-fund' || normalized === 'morningstarfund') return 'Morningstar-Fund';
  if (normalized === 'security') return 'Security';
  if (normalized === 'index') return 'Index';
  return '';
}

/** Parse a loose asset-class string (handles common abbreviations) into a canonical value. */
export function parseAssetClass(value: string): AssetClass | '' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'equity' || normalized === 'eq' || normalized === 'stock' || normalized === 'stocks') {
    return 'Equity';
  }
  if (normalized === 'fixed income' || normalized === 'fi' || normalized === 'bond' || normalized === 'bonds' || normalized === 'fixedincome') {
    return 'Fixed Income';
  }
  if (normalized === 'alternatives' || normalized === 'alt' || normalized === 'alts' || normalized === 'alternative') {
    return 'Alternatives';
  }
  if (normalized === 'crypto' || normalized === 'cryptocurrency') {
    return 'Crypto';
  }
  if (normalized === 'fundoffunds' || normalized === 'fof' || normalized === 'fund of funds') {
    return 'Fund of Funds';
  }
  if (normalized === 'multi-asset' || normalized === 'multiasset' || normalized === 'multi asset' || normalized === 'multi') {
    return 'Multi-Asset';
  }
  return '';
}

/**
 * Normalize an already-typed holdings array so weights sum to 1, dropping any
 * incomplete or zero-sum entries. Safe to run server-side on untrusted input.
 */
export function normalizeHoldingWeights(holdings: PortfolioHolding[]): PortfolioHolding[] {
  const valid = (holdings ?? []).filter(
    (h) =>
      h &&
      typeof h.identifier === 'string' && h.identifier.trim() &&
      ASSET_CLASSES.includes(h.assetClass) &&
      CONSTITUENT_TYPES.includes(h.constituentType) &&
      Number.isFinite(h.weight) && h.weight > 0
  );
  if (valid.length === 0) return [];

  const sum = valid.reduce((acc, h) => acc + h.weight, 0);
  if (sum <= 0) return [];

  return valid.map((h) => ({
    identifier: h.identifier.trim().toUpperCase(),
    constituentType: h.constituentType,
    assetClass: h.assetClass,
    weight: h.weight / sum,
  }));
}
