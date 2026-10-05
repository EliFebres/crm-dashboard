/**
 * De-duplicates identical GETs fired in the same task — e.g. sibling settings
 * sections that each load /api/teams on mount. Only requests started in the
 * same macrotask share a response, so a later refetch (after an edit or a live
 * update) always goes to the server. Each caller gets its own copy of the body.
 */
interface SharedResult {
  ok: boolean;
  status: number;
  data: unknown;
}

const inflight = new Map<string, Promise<SharedResult>>();

export async function sharedGetJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T }> {
  let pending = inflight.get(url);
  if (!pending) {
    pending = fetch(url).then(async res => ({
      ok: res.ok,
      status: res.status,
      data: res.ok ? await res.json() : undefined,
    }));
    inflight.set(url, pending);
    setTimeout(() => inflight.delete(url), 0);
  }
  const result = await pending;
  return { ok: result.ok, status: result.status, data: structuredClone(result.data) as T };
}
