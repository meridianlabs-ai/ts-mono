import {
  Component,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { findTextOfElement } from "./findText";
import type { FindSegment } from "./types";

// Rows are rendered offscreen in small batches so one commit never blocks the
// main thread for long; the batch advance runs in a transition (time-sliced).
const BATCH_SIZE = 4; // chosen-by-agent: keeps commits small; big rows dominate anyway

interface CacheEntry {
  cacheKey: unknown;
  lowerText: string;
}

// Cache keys may be arrays of identities (event object, neighbor id, lane):
// compare element-wise so a rebuilt-but-equal key still hits the cache.
const sameCacheKey = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

export interface FindCorpusOptions<T> {
  /** Render specs in document order. Must be referentially stable per data
   *  change (memoized by the caller). */
  items: readonly T[];
  keyOf: (item: T) => string;
  /** Identity of everything the rendered text depends on for this item —
   *  a changed value re-extracts that item. */
  cacheKeyOf: (item: T) => unknown;
  /** Render the item through the SAME component code path the live list
   *  uses (the corpus is the renderer's own output, not a mirror). */
  renderItem: (item: T, index: number) => ReactNode;
  /** Only index while true (the find band is open). */
  active: boolean;
}

export interface FindCorpus {
  /** Segments in document order, or null while extraction is incomplete. */
  segments: readonly FindSegment[] | null;
  /** Document-order prefix extracted so far (=== segments once complete).
   *  For unchanged items it only ever grows, so match ordinals derived from
   *  it are already final — this is what progressive find relies on. */
  prefixSegments: readonly FindSegment[];
  /** Offscreen extraction probe — must be rendered by the caller (inside its
   *  own tree position, so portal rows inherit every provider). */
  probe: ReactNode;
}

// One throwing row must not kill the whole corpus: it contributes no text
// (degraded, logged) and extraction proceeds.
class RowBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: unknown): void {
    console.warn("find corpus: row render failed", error);
    this.props.onError();
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/** Builds a rendered-text corpus for a virtualized list by mounting each row
 *  once in a display:none portal and extracting its find-text. Cached per
 *  (key, cacheKey); extraction is commit-driven (each batch's layout effect
 *  schedules the next batch) — no timers, no polling. */
export function useFindCorpus<T>(options: FindCorpusOptions<T>): FindCorpus {
  const { items, keyOf, cacheKeyOf, renderItem, active } = options;
  // State-held mutable containers (not refs): the batch memo below reads them
  // during render, which is safe because they're only written in commit-phase
  // effects — the read is stable for the duration of a render.
  const [cache] = useState(() => new Map<string, CacheEntry>());
  // Host div for the portal; attached (display:none) only while indexing.
  const [host] = useState<HTMLElement>(() => {
    const el = document.createElement("div");
    el.style.display = "none";
    el.setAttribute("data-find-corpus-probe", "true");
    return el;
  });
  // Extraction progress counter: bumping it is what re-runs the batch memo
  // below after each commit, driving the scan forward without timers.
  const [extracted, setExtracted] = useState(0);

  const batch = useMemo(() => {
    if (!active) return [];
    const out: { item: T; index: number; key: string }[] = [];
    for (let i = 0; i < items.length && out.length < BATCH_SIZE; i++) {
      const item = items[i]!;
      const key = keyOf(item);
      const entry = cache.get(key);
      if (!entry || !sameCacheKey(entry.cacheKey, cacheKeyOf(item))) {
        out.push({ item, index: i, key });
      }
    }
    return out;
    // `extracted` is deliberately a dep: each batch commit bumps it so the
    // scan advances past freshly cached items.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extracted is the driver, not read
  }, [active, items, keyOf, cacheKeyOf, extracted]);

  const complete = active && batch.length === 0;

  const hasWork = batch.length > 0;
  useEffect(() => {
    if (!hasWork) return;
    document.body.appendChild(host);
    return () => {
      host.remove();
    };
  }, [host, hasWork]);

  // Extract after the batch committed, then advance (transition-scheduled so
  // the next batch render is interruptible by user input).
  useLayoutEffect(() => {
    if (batch.length === 0) return;
    for (const { item, key } of batch) {
      const el = host.querySelector(
        `[data-find-probe-key="${cssEscape(key)}"]`
      );
      cache.set(key, {
        cacheKey: cacheKeyOf(item),
        lowerText: el ? findTextOfElement(el) : "",
      });
    }
    startTransition(() => setExtracted((n) => n + 1));
  }, [batch, cacheKeyOf, host, cache]);

  const segments = useMemo<readonly FindSegment[] | null>(() => {
    if (!complete) return null;
    return items.map((item) => {
      const key = keyOf(item);
      return { key, lowerText: cache.get(key)?.lowerText ?? "" };
    });
  }, [complete, items, keyOf, cache]);

  // Longest prefix of items with a current cache entry. The batch scan above
  // always extracts the FIRST uncached item, so this is the document-order
  // prefix and grows front-first; stopping at the first miss (not skipping
  // it) is what keeps ordinals derived from it final.
  const prefixSegments = useMemo<readonly FindSegment[]>(() => {
    if (!active) return [];
    const out: FindSegment[] = [];
    for (const item of items) {
      const key = keyOf(item);
      const entry = cache.get(key);
      if (!entry || !sameCacheKey(entry.cacheKey, cacheKeyOf(item))) break;
      out.push({ key, lowerText: entry.lowerText });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- extracted drives growth, not read
  }, [active, items, keyOf, cacheKeyOf, extracted]);

  const probe =
    batch.length > 0
      ? createPortal(
          <>
            {batch.map(({ item, index, key }) => (
              <div key={key} data-find-probe-key={key}>
                <RowBoundary onError={() => undefined}>
                  {renderItem(item, index)}
                </RowBoundary>
              </div>
            ))}
          </>,
          host
        )
      : null;

  return { segments, prefixSegments, probe };
}

const cssEscape = (value: string): string =>
  typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(value)
    : value.replace(/"/g, '\\"');
