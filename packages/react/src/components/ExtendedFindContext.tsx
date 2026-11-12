import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useRef,
} from "react";

export type FindDirection = "forward" | "backward";

export interface ItemMatchCount {
  item: number;
  count: number;
}

/**
 * A virtualized list's side of find. Its items may not be rendered, so the
 * list counts matches in its data and scrolls an item into the DOM on
 * request. The find band highlights matches in rendered items itself.
 */
export interface FindSource {
  /** An element at the list's place in the page: matches in the page before
   *  it are numbered before the list's. Null while the list isn't mounted. */
  anchor: () => Element | null;
  /** Data-side match counts by item, in ascending item order, omitting
   *  items without a match. Includes items that aren't rendered. */
  countByItem: (term: string) => readonly ItemMatchCount[];
  /** The item a rendered DOM node belongs to, or null if it isn't inside one
   *  of this list's items. */
  itemOf: (node: Node) => number | null;
  /** Items currently in the DOM, whether or not they contain a match. */
  renderedItems: () => ReadonlySet<number>;
  /** Brings an item into the DOM. Resolves true once it is rendered, false
   *  if it never renders. Aborting `signal` (a newer find navigation) stops
   *  its scroll. Rejects if another scroll takes over first. */
  reveal: (
    item: number,
    direction: FindDirection,
    signal: AbortSignal
  ) => Promise<boolean>;
}

/** Wraps a per-term computation so repeated calls for the same term (every
 *  re-collect while the band is open) reuse the last result. */
export function cacheLastTerm<T>(
  compute: (term: string) => T
): (term: string) => T {
  let last: { term: string; value: T } | null = null;
  return (term) => {
    if (last?.term !== term) last = { term, value: compute(term) };
    return last.value;
  };
}

interface ExtendedFindContextType {
  registerFindSource: (id: string, source: FindSource) => () => void;
  getFindSources: () => ReadonlyMap<string, FindSource>;
  /** Notifies on every (un)registration. Sources re-register when their data
   *  changes, so this is also the signal that counts may have changed. */
  subscribeFindSources: (listener: () => void) => () => void;
}

const ExtendedFindContext = createContext<ExtendedFindContextType | null>(null);

interface ExtendedFindProviderProps {
  children: ReactNode;
}

export const ExtendedFindProvider = ({
  children,
}: ExtendedFindProviderProps) => {
  const sources = useRef<Map<string, FindSource>>(new Map());
  const listeners = useRef<Set<() => void>>(new Set());

  const notify = useCallback(() => {
    for (const listener of listeners.current) listener();
  }, []);

  const registerFindSource = useCallback(
    (id: string, source: FindSource): (() => void) => {
      sources.current.set(id, source);
      notify();
      return () => {
        sources.current.delete(id);
        notify();
      };
    },
    [notify]
  );

  const getFindSources = useCallback(() => sources.current, []);

  const subscribeFindSources = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const contextValue: ExtendedFindContextType = {
    registerFindSource,
    getFindSources,
    subscribeFindSources,
  };

  return (
    <ExtendedFindContext.Provider value={contextValue}>
      {children}
    </ExtendedFindContext.Provider>
  );
};

export const useExtendedFind = (): ExtendedFindContextType => {
  const context = useExtendedFindOptional();
  if (!context) {
    throw new Error(
      "useExtendedFind must be used within an ExtendedFindProvider"
    );
  }
  return context;
};

/** Null outside an ExtendedFindProvider, for components (e.g. VirtualList)
 *  that integrate with find when available but must not require it. */
export const useExtendedFindOptional = (): ExtendedFindContextType | null =>
  useContext(ExtendedFindContext);
