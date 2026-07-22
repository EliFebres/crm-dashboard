import { Database } from 'lucide-react';

/**
 * Placeholder for a card whose chart needs market data the app does not hold.
 *
 * portfolio.sqlite stores identifiers, asset class, constituent type and weight. Market
 * cap, price-to-book, profitability, duration, credit rating, yield and maturity all
 * require a security master keyed by identifier — see PortfolioTrendsResponse.marketData.
 * Rather than render invented numbers, an affected card names the fields it is waiting on,
 * so the shape of the pending ingest is visible in the UI itself.
 *
 * The card shell (title, subtitle, sizing) stays put, so each chart can drop straight back
 * in once `marketData` is non-null.
 */
export default function RequiresMarketData({ needs }: { needs: string[] }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <Database className="h-5 w-5 text-zinc-600" aria-hidden />
      <p className="text-xs font-medium text-zinc-400">Requires market data</p>
      <p className="max-w-[260px] text-[11px] leading-relaxed text-zinc-600">
        Needs {needs.join(', ')} — none of which can be derived from a ticker without a
        security master.
      </p>
    </div>
  );
}
