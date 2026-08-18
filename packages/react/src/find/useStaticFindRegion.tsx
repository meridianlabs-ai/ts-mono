import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type FC,
  type ReactNode,
  type RefCallback,
} from "react";

import { useRegisterFindSource } from "./FindContext";
import { findTextOfElement } from "./findText";
import type { FindSegment, FindSource } from "./types";

export interface UseStaticFindRegionOptions {
  /** Unique region key within the surface's FindProvider. */
  key: string;
  /** Identity of the rendered content — a change re-extracts. The region's
   *  text must be stable per contentKey (fully rendered prose, no lazy
   *  content), because segments come straight from the mounted DOM. */
  contentKey?: unknown;
  /** When false, the region does not register as a find source. A screen
   *  state must never have ONLY partial-coverage sources: a small region
   *  (e.g. the sample header) must yield on tabs whose pane content is not
   *  wired, so the surface drops to zero sources and the whole-DOM
   *  window.find fallback covers everything. */
  enabled?: boolean;
}

/** Find source for a long-form prose pane that is fully rendered in place:
 *  no offscreen probe — the mounted DOM is the corpus; reveal is a plain
 *  scrollIntoView. Attach the returned ref to the pane element. */
export function useStaticFindRegion(
  options: UseStaticFindRegionOptions
): RefCallback<HTMLElement> {
  const { key, contentKey, enabled = true } = options;
  const elementRef = useRef<HTMLElement | null>(null);
  const cacheRef = useRef<{
    element: HTMLElement;
    segments: FindSegment[];
  } | null>(null);
  const listenersRef = useRef(new Set<() => void>());
  const keyRef = useRef(key);

  // Post-commit, so the re-extraction reads the DOM that the new content
  // actually produced.
  useEffect(() => {
    keyRef.current = key;
    cacheRef.current = null;
    for (const listener of listenersRef.current) listener();
  }, [key, contentKey]);

  const regionRef = useCallback<RefCallback<HTMLElement>>((element) => {
    elementRef.current = element;
    cacheRef.current = null;
    // Attach/detach changes what is findable — recount now, not on the next
    // unrelated corpus notify.
    for (const listener of listenersRef.current) listener();
  }, []);

  const source = useMemo<FindSource>(
    () => ({
      getSegments: () => {
        const element = elementRef.current;
        if (!element) return [];
        const cached = cacheRef.current;
        if (cached && cached.element === element) return cached.segments;
        const segments = [
          { key: keyRef.current, lowerText: findTextOfElement(element) },
        ];
        cacheRef.current = { element, segments };
        return segments;
      },
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
      reveal: (_key, onSettled) => {
        elementRef.current?.scrollIntoView({
          block: "center",
          behavior: "auto",
        });
        onSettled();
      },
      getContainer: () => elementRef.current,
      getElement: (k) => (k === keyRef.current ? elementRef.current : null),
      cleanup: () => undefined,
    }),
    []
  );
  useRegisterFindSource(enabled ? source : null);

  return regionRef;
}

interface StaticFindRegionProps {
  /** Unique region key within the surface's FindProvider. */
  findKey: string;
  /** Identity of the rendered content — a change re-extracts. */
  contentKey?: unknown;
  /** When false, does not register as a find source (see
   *  UseStaticFindRegionOptions.enabled). */
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** Component form of useStaticFindRegion: wraps children in the region div. */
export const StaticFindRegion: FC<StaticFindRegionProps> = ({
  findKey,
  contentKey,
  enabled,
  className,
  children,
}) => {
  const regionRef = useStaticFindRegion({ key: findKey, contentKey, enabled });
  return (
    <div ref={regionRef} className={className}>
      {children}
    </div>
  );
};
