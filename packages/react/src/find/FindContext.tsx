import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type FC,
  type ReactNode,
} from "react";

import { FindController, type FindSnapshot } from "./FindController";
import type { FindSource } from "./types";

const FindContext = createContext<FindController | null>(null);

/** Hosts one FindController for a surface (log view, sample detail, scout
 *  app). Sources register below it; the FindBar renders from it. */
export const FindProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [controller] = useState(() => new FindController());
  return (
    <FindContext.Provider value={controller}>{children}</FindContext.Provider>
  );
};

export const useFindController = (): FindController => {
  const controller = useContext(FindContext);
  if (!controller) {
    throw new Error("useFindController requires a FindProvider ancestor");
  }
  return controller;
};

/** Null outside a provider — for components (e.g. shared panels) that only
 *  optionally participate in find. */
export const useOptionalFindController = (): FindController | null =>
  useContext(FindContext);

export const useFindSnapshot = (): FindSnapshot => {
  const controller = useFindController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
};

const INACTIVE_SNAPSHOT: FindSnapshot = {
  active: false,
  term: "",
  query: "",
  total: 0,
  ordinal: 0,
  indexing: false,
  hasSources: false,
  fallbackNoMatch: false,
};
const noopSubscribe = () => () => {};
const inactiveSnapshot = () => INACTIVE_SNAPSHOT;

/** Snapshot that degrades to inactive outside a provider — for shared
 *  components (sources) that must render fine without find wiring. */
export const useOptionalFindSnapshot = (): FindSnapshot => {
  const controller = useOptionalFindController();
  return useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : inactiveSnapshot
  );
};

/** Register a source for the lifetime of the calling component. The source
 *  object must be stable (memoized) — re-registration resets navigation. */
export const useRegisterFindSource = (source: FindSource | null): void => {
  const controller = useOptionalFindController();
  useEffect(() => {
    if (!controller || !source) return;
    return controller.registerSource(source);
  }, [controller, source]);
};
