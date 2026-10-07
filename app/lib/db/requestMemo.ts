import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request-scoped memoization for small registry lookups (type colors, names,
 * office rosters) that several aggregations in one request each ask for.
 *
 * Inside `withRequestMemo(fn)`, `memo(key, load)` runs `load` once per key and
 * hands every caller the same promise. Nothing outlives the request, so results
 * are exactly as fresh as uncached reads. Outside a scope, `memo` just calls `load`.
 */
const store = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withRequestMemo<T>(fn: () => Promise<T>): Promise<T> {
  return store.run(new Map(), fn);
}

export function memo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cache = store.getStore();
  if (!cache) return load();
  let hit = cache.get(key) as Promise<T> | undefined;
  if (!hit) {
    hit = load();
    cache.set(key, hit);
  }
  return hit;
}
