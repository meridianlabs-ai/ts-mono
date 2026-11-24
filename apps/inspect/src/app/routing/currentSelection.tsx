import { createContext, useContext, type ReactNode } from "react";
import { useLocation } from "react-router";

import { useMirrorToStore } from "@tsmono/react/hooks";

import { resolveRouteLogFile, useLogDir } from "../../app_config";
import type { SampleSummary } from "../../client/api/types";
import { useSampleSummaries } from "../../log_data";
import { highlightSample } from "../../state/actions";
import type { SampleHandle } from "../types";

import {
  selectionRouteParams,
  type LogOrSampleRouteParams,
} from "./routeParams";

interface CurrentSelection {
  logFile: string | undefined;
  sample: SampleHandle | undefined;
}
const SelectionContext = createContext<CurrentSelection | null>(null);

export function routeLogFile(
  pathname: string,
  params: LogOrSampleRouteParams
): string | undefined {
  const path = params.logPath;
  if (!path) return undefined;
  // A /samples path without an id/epoch names a collection, even when its
  // folder name happens to end in .eval or .json.
  if (pathname.startsWith("/samples/") && !(params.id && params.epoch))
    return undefined;
  return params.id ||
    params.uuid ||
    path.endsWith(".eval") ||
    path.endsWith(".json")
    ? path
    : undefined;
}

export function currentSample(
  logFile: string | undefined,
  params: LogOrSampleRouteParams,
  summaries: readonly Pick<SampleSummary, "id" | "epoch">[]
): SampleHandle | undefined {
  if (!logFile) return undefined;
  if (params.id !== undefined || params.epoch !== undefined || params.uuid) {
    const epoch = Number(params.epoch);
    return params.id !== undefined &&
      params.epoch !== undefined &&
      Number.isInteger(epoch) &&
      epoch >= 0
      ? { logFile, id: params.id, epoch }
      : undefined;
  }
  const sample = summaries.length === 1 ? summaries[0] : undefined;
  return sample ? { logFile, id: sample.id, epoch: sample.epoch } : undefined;
}

export function useRouteSelection(pathname: string) {
  const params = selectionRouteParams(pathname);
  const logDir = useLogDir();
  const path = routeLogFile(pathname, params);
  const logFile = path ? resolveRouteLogFile(path) : undefined;
  const summaries = useSampleSummaries(logDir, logFile);
  const sample = currentSample(logFile, params, summaries.data ?? []);
  return {
    logFile,
    sample,
    summaries: summaries.data ?? [],
    hasExplicitSample:
      params.id !== undefined ||
      params.epoch !== undefined ||
      params.uuid !== undefined,
  };
}

/** Current data identity is derived from routing; UI selection cannot override it. */
export function CurrentSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const { logFile, sample } = useRouteSelection(pathname);
  // Remember the visited row for return-to-list highlighting. No live data
  // consumer reads this historical selection.
  useMirrorToStore(sample, (handle) =>
    highlightSample(handle.id, handle.epoch, handle.logFile)
  );
  return (
    <SelectionContext.Provider value={{ logFile, sample }}>
      {children}
    </SelectionContext.Provider>
  );
}

function useCurrentSelection(): CurrentSelection {
  const selection = useContext(SelectionContext);
  if (!selection)
    throw new Error("Current selection requires CurrentSelectionProvider");
  return selection;
}
export const useCurrentLogFile = () => useCurrentSelection().logFile;
export const useCurrentSampleHandle = () => useCurrentSelection().sample;
