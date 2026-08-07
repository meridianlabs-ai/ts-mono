import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useRef,
} from "react";

// The search context provides global search assistance. We generally use the
// browser to perform searches using 'find', but this allows for virtual lists
// and other virtualized components to register themselves to be notified when a
// search is requested and no matches are found. In this case, they can 'look ahead'
// and scroll an item into view if it is likely/certain to contain the search term.

export type FindDirection = "forward" | "backward";

// Find will call this when an extended find is requested
export type ExtendedFindFn = (
  term: string,
  direction: FindDirection,
  onContentReady: () => void
) => Promise<boolean>;

// Count total matches across all data items
export type ExtendedCountFn = (term: string) => number;

/**
 * Locates the current document selection within one source's match list.
 * Returns the 0-based index of the match the selection sits on, or null when
 * the selection is not on one of this source's matches.
 */
export type MatchLocatorFn = (term: string) => number | null;

// The context provides an extended search function and a way for the active
// virtual lists to register themselves.
interface ExtendedFindContextType {
  extendedFindTerm: (
    term: string,
    direction: FindDirection
  ) => Promise<boolean>;
  registerVirtualList: (id: string, searchFn: ExtendedFindFn) => () => void;
  countAllMatches: (term: string) => number;
  registerMatchCounter: (id: string, countFn: ExtendedCountFn) => () => void;
  registerMatchLocator: (id: string, locatorFn: MatchLocatorFn) => () => void;
  /**
   * 0-based ordinal of the current selection across all registered sources,
   * or null when no source claims it.
   *
   * Sources are visited in `registerMatchCounter` order and each non-claiming
   * source contributes its match count as an offset, so the result indexes
   * into the same total `countAllMatches` reports. A source that registers a
   * locator but no counter is never visited — an offset is meaningless
   * without a count.
   */
  ordinalAtSelection: (term: string) => number | null;
  /** Open a new find session; call when the find band mounts. */
  beginFindSession: () => void;
  /** Identifies the current find session (see `beginFindSession`). */
  getFindSessionId: () => number;
  // Bumped on every counter (un)registration. Counters re-register when
  // their underlying data changes, so this doubles as a cheap content
  // version for invalidating cached countAllMatches results.
  getMatchCountersVersion: () => number;
}

const ExtendedFindContext = createContext<ExtendedFindContextType | null>(null);

interface ExtendedFindProviderProps {
  children: ReactNode;
}

export const ExtendedFindProvider = ({
  children,
}: ExtendedFindProviderProps) => {
  const virtualLists = useRef<Map<string, ExtendedFindFn>>(new Map());
  const matchCounters = useRef<Map<string, ExtendedCountFn>>(new Map());
  const matchLocators = useRef<Map<string, MatchLocatorFn>>(new Map());
  // Registration id → the sequence number it was first registered under.
  // Outlives unregistration on purpose; see registerMatchCounter.
  const counterOrder = useRef<Map<string, number>>(new Map());
  const nextCounterSeq = useRef(0);
  // Bumped each time the find band opens. Sources that carry a navigation
  // cursor across presses tag it with this and discard it when it changes —
  // the band unmounts on close but the lists it searched do not, so without
  // it a cursor would survive into an unrelated later search.
  const findSession = useRef(0);
  const matchCountersVersion = useRef(0);

  const extendedFindTerm = useCallback(
    async (term: string, direction: FindDirection): Promise<boolean> => {
      for (const [, searchFn] of virtualLists.current) {
        const found = await new Promise<boolean>((resolve) => {
          let callbackFired = false;

          const onContentReady = () => {
            if (!callbackFired) {
              callbackFired = true;
              resolve(true);
            }
          };

          searchFn(term, direction, onContentReady)
            .then((found) => {
              if (!found && !callbackFired) {
                callbackFired = true;
                resolve(false);
              }
            })
            .catch(() => {
              if (!callbackFired) {
                callbackFired = true;
                resolve(false);
              }
            });
        });

        if (found) {
          return true;
        }
      }
      return false;
    },
    []
  );

  const registerVirtualList = useCallback(
    (id: string, searchFn: ExtendedFindFn): (() => void) => {
      virtualLists.current.set(id, searchFn);
      return () => {
        virtualLists.current.delete(id);
      };
    },
    []
  );

  const countAllMatches = useCallback((term: string): number => {
    let total = 0;
    for (const [, countFn] of matchCounters.current) {
      total += countFn(term);
    }
    return total;
  }, []);

  const registerMatchCounter = useCallback(
    (id: string, countFn: ExtendedCountFn): (() => void) => {
      // Remember the order an id was FIRST seen in, and never forget it.
      // `ordinalAtSelection` turns each non-claiming source's count into an
      // offset, so the enumeration order has to be stable — and Map order is
      // not: re-registration is delete-then-set, and `Map.set` on a deleted
      // key appends at the tail. A source whose countFn identity changes on
      // every render (an un-memoised list) would otherwise keep jumping to
      // the end and shifting every other source's offset, making the counter
      // jump with no corresponding navigation. Entries are kept after
      // unregistration so a remount lands back in its original slot; the map
      // is keyed by registration id, so it stays tiny.
      if (!counterOrder.current.has(id)) {
        counterOrder.current.set(id, nextCounterSeq.current++);
      }
      matchCounters.current.set(id, countFn);
      matchCountersVersion.current++;
      return () => {
        matchCounters.current.delete(id);
        matchCountersVersion.current++;
      };
    },
    []
  );

  const beginFindSession = useCallback(() => {
    findSession.current++;
  }, []);

  const getFindSessionId = useCallback(() => findSession.current, []);

  /** Registered counter ids in stable first-registration order. */
  const orderedCounterIds = useCallback(
    (): string[] =>
      [...matchCounters.current.keys()].sort(
        (a, b) =>
          (counterOrder.current.get(a) ?? 0) -
          (counterOrder.current.get(b) ?? 0)
      ),
    []
  );

  const registerMatchLocator = useCallback(
    (id: string, locatorFn: MatchLocatorFn): (() => void) => {
      matchLocators.current.set(id, locatorFn);
      return () => {
        matchLocators.current.delete(id);
      };
    },
    []
  );

  const ordinalAtSelection = useCallback(
    (term: string): number | null => {
      let offset = 0;
      for (const id of orderedCounterIds()) {
        const countFn = matchCounters.current.get(id);
        if (countFn === undefined) continue;
        const idx = matchLocators.current.get(id)?.(term) ?? null;
        if (idx !== null) return offset + idx;
        offset += countFn(term);
      }
      return null;
    },
    [orderedCounterIds]
  );

  const getMatchCountersVersion = useCallback(
    () => matchCountersVersion.current,
    []
  );

  const contextValue: ExtendedFindContextType = {
    extendedFindTerm,
    registerVirtualList,
    countAllMatches,
    registerMatchCounter,
    registerMatchLocator,
    ordinalAtSelection,
    beginFindSession,
    getFindSessionId,
    getMatchCountersVersion,
  };

  return (
    <ExtendedFindContext.Provider value={contextValue}>
      {children}
    </ExtendedFindContext.Provider>
  );
};

export const useExtendedFind = (): ExtendedFindContextType => {
  const context = useContext(ExtendedFindContext);
  if (!context) {
    throw new Error("useSearch must be used within a SearchProvider");
  }
  return context;
};
