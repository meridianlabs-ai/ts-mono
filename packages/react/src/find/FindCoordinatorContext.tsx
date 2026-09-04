import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";

import { useUnmount } from "../hooks/useUnmount";

import { FIND_IDLE_STATE, FindStore } from "./findStore";
import type { FindCoordinator, FindState } from "./types";

// The context carries the store itself (stable identity): state consumers
// subscribe via useSyncExternalStore, so a keystroke re-renders only the
// components that read find state — not the whole tree under the provider.
const FindCoordinatorContext = createContext<FindStore | null>(null);

interface FindProviderProps {
  children: ReactNode;
}

/** The find coordinator: a registry of per-scope FindSurfaces plus the
 *  query/match-window store FindBand and the per-row highlighter consume. */
export const FindProvider: FC<FindProviderProps> = ({ children }) => {
  const [store] = useState(() => new FindStore());
  useUnmount(() => store.dispose());
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

const noopSubscribe = () => () => {};

/** Live find state; the idle state outside a FindProvider. */
export const useFindState = (): FindState => {
  const store = useContext(FindCoordinatorContext);
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getState : () => FIND_IDLE_STATE
  );
};
