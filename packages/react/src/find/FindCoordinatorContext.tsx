import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useEffect,
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

/** Register a surface for as long as the component is mounted. No-op
 *  outside a FindProvider. Re-registers whenever `surface` changes
 *  identity — sources are memoized on their data, so a data change
 *  re-registers and the coordinator re-surveys (store invalidation). */
export const useFindSurface = (surface: FindSurface | null): void => {
  const store = useContext(FindCoordinatorContext);
  useEffect(() => {
    if (!store || !surface) return;
    return store.registerSurface(surface);
  }, [store, surface]);
};
