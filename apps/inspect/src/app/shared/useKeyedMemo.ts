import { useRef } from "react";

const shallowEqual = (
  a: readonly unknown[],
  b: readonly unknown[]
): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
};

/**
 * Map a list to derived values, reusing the prior output object for any item
 * whose per-item deps are unchanged.
 *
 * `useMemo` is all-or-nothing: any dep change rebuilds every element, handing
 * a consumer (e.g. AG-Grid) all-new identities and forcing a full refresh.
 * This keeps a per-key cache so only the items that actually changed get a new
 * object — the rest keep reference identity. Reuse is gated on `itemDeps`, so
 * the cache must be pure: same deps must always yield the same value.
 *
 * The list is re-walked on every render; reuse keeps that cheap (a shallow dep
 * compare per item, builds only on change). The returned array keeps the same
 * reference when nothing changed, so consumers that key off its identity (deps
 * arrays, AG-Grid's rowData diff) don't re-run on unrelated renders.
 */
export function useKeyedMemo<S, T>(
  source: readonly S[],
  getKey: (item: S) => string,
  itemDeps: (item: S) => readonly unknown[],
  build: (item: S) => T
): T[] {
  const cacheRef = useRef(
    new Map<string, { deps: readonly unknown[]; value: T }>()
  );
  const resultRef = useRef<T[]>([]);

  const prev = cacheRef.current;
  const next = new Map<string, { deps: readonly unknown[]; value: T }>();
  let changed = source.length !== resultRef.current.length;
  const result = source.map((item, i) => {
    const key = getKey(item);
    const deps = itemDeps(item);
    const hit = prev.get(key);
    const value = hit && shallowEqual(hit.deps, deps) ? hit.value : build(item);
    next.set(key, { deps, value });
    if (!changed && resultRef.current[i] !== value) changed = true;
    return value;
  });
  cacheRef.current = next;
  if (changed) resultRef.current = result;
  return resultRef.current;
}
