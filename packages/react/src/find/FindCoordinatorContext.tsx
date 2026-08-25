import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { FindStore } from "./findStore";
import type { FindCoordinator, FindState, FindSurface } from "./types";

// The context carries the store itself (stable identity): state consumers
// subscribe via useSyncExternalStore, so a keystroke re-renders only the
// components that read find state — not the whole tree under the provider.
const FindCoordinatorContext = createContext<FindStore | null>(null);

interface FindProviderProps {
  children: ReactNode;
}

/** The find coordinator (replaces ExtendedFindProvider): a registry of
 *  per-scope FindSurfaces plus the query/match-window store FindBand and
 *  the per-row highlighter consume. */
export const FindProvider: FC<FindProviderProps> = ({ children }) => {
  const [store] = useState(() => new FindStore());
  useEffect(() => () => store.dispose(), [store]);
  return (
    <FindCoordinatorContext.Provider value={store}>
      {children}
    </FindCoordinatorContext.Provider>
  );
};

/** Null outside a FindProvider, for surfaces that integrate with find when
 *  available but must not require it. */
export const useFindCoordinatorOptional = (): FindCoordinator | null =>
  useContext(FindCoordinatorContext);

export const useFindCoordinator = (): FindCoordinator => {
  const store = useContext(FindCoordinatorContext);
  if (!store) {
    throw new Error("useFindCoordinator must be used within a FindProvider");
  }
  return store;
};

const IDLE_STATE: FindState = {
  term: "",
  matches: [],
  activeIndex: null,
  total: null,
  complete: false,
  progress: null,
  searching: false,
  noResults: false,
  scopeId: null,
  lastDirection: "forward",
};

const noopSubscribe = () => () => {};

/** Live find state; the idle state outside a FindProvider. */
export const useFindState = (): FindState => {
  const store = useContext(FindCoordinatorContext);
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getState : () => IDLE_STATE
  );
};

/** Non-subscribing accessor for surfaces whose reveal() needs the current
 *  term/direction: reading through the getter avoids re-rendering a heavy
 *  host (e.g. the whole transcript layout) on every keystroke. */
export const useFindStateGetter = (): (() => FindState) => {
  const store = useContext(FindCoordinatorContext);
  // Memoized so consumers can put the getter in dependency arrays.
  return useMemo(
    () => (store ? () => store.getState() : () => IDLE_STATE),
    [store]
  );
};

/** Register a surface for as long as the component is mounted. No-op
 *  outside a FindProvider. Re-registers only when the scope or SOURCE
 *  changes identity — sources are memoized on their data, so a data change
 *  re-registers and the coordinator re-surveys (store invalidation).
 *  reveal() is read through a ref: it closes over fast-moving view state
 *  (selection, scroll handles), and re-registering per closure identity
 *  would re-survey — or, with registration notifying state subscribers,
 *  loop — on every render. */
export const useFindSurface = (surface: FindSurface | null): void => {
  const store = useContext(FindCoordinatorContext);
  const revealRef = useRef<FindSurface["reveal"] | null>(null);
  useEffect(() => {
    revealRef.current = surface?.reveal ?? null;
  });
  const scopeId = surface?.scopeId;
  const source = surface?.source;
  useEffect(() => {
    if (!store || scopeId === undefined || source === undefined) return;
    return store.registerSurface({
      scopeId,
      source,
      reveal: (match, signal) =>
        revealRef.current
          ? revealRef.current(match, signal)
          : Promise.resolve("missing"),
    });
  }, [store, scopeId, source]);
};
