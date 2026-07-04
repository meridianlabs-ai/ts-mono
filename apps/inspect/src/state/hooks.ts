import { useCallback, useEffect, useMemo, useRef } from "react";

import { EvalSample, LogHandle } from "@tsmono/inspect-common/types";
import { createLogger } from "@tsmono/util";

import { EvalLogStatus } from "../@types/extraInspect";
import { getApi, useLogDir } from "../app_config";
import {
  createEvalDescriptor,
  createSamplesDescriptor,
} from "../app/samples/descriptor/samplesDescriptor";
import { ScoreView } from "../app/samples/header-v2/ViewToggle";
import { filterSamples } from "../app/samples/sample-tools/filters";
import { sampleIdsEqual } from "../app/shared/sample";
import { LogDetails, RunningMetric, SampleSummary } from "../client/api/types";
import {
  useLogDetail,
  useLogHandles,
  useLogPreviews,
  usePassiveEvalSample,
  useRunningMetrics,
  useSampleData,
  useSampleSummaries,
  type SampleData,
} from "../log_data";

import { refreshLog } from "./actions";
import { getAvailableScorers } from "./scoring";
import { useStore } from "./store";

const kScorePanelViewBag = "score-panel-view";
const kScorePanelViewKey = "view";
const kScorePanelSortBag = "score-panel-sort";
const kScorePanelSortKey = "sort";

export type ScorePanelSortColumn = "name" | "value" | null;
export interface ScorePanelSortState {
  column: ScorePanelSortColumn;
  dir: "asc" | "desc";
}
const kDefaultScorePanelSort: ScorePanelSortState = {
  column: null,
  dir: "asc",
};

/**
 * Read / write the user's preferred V2 score panel view (chips vs grid).
 * Persisted globally via the app property bag so the choice carries
 * across samples. Returns the *stored* value; callers resolve their
 * own default (typically `chips` for ≤ 6 scores, `grid` for 7+).
 */
export const useScorePanelView = (): [
  ScoreView | undefined,
  (view: ScoreView) => void,
] => {
  const stored = useStore(
    (state) =>
      state.app.propertyBags[kScorePanelViewBag]?.[kScorePanelViewKey] as
        | ScoreView
        | undefined
  );
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const setView = useCallback(
    (view: ScoreView) => {
      setPropertyValue(kScorePanelViewBag, kScorePanelViewKey, view);
    },
    [setPropertyValue]
  );
  return [stored, setView];
};

/**
 * Resolve the stored / eval-supplied / default view given the score count.
 * Priority: user override (stored) > eval default > built-in count rule.
 */
export const resolveScorePanelView = (
  stored: ScoreView | undefined,
  evalDefault: ScoreView | undefined,
  count: number
): ScoreView => stored ?? evalDefault ?? (count <= 6 ? "chips" : "grid");

/**
 * Read / write the user's V2 score panel sort. Persisted globally via
 * the app property bag (mirrors `useScorePanelView`) so the sort
 * carries across samples in the same session. Returns the *stored*
 * value; callers resolve their own default via `resolveScorePanelSort`.
 */
export const useScorePanelSort = (): [
  ScorePanelSortState | undefined,
  (sort: ScorePanelSortState) => void,
] => {
  const stored = useStore(
    (state) =>
      state.app.propertyBags[kScorePanelSortBag]?.[kScorePanelSortKey] as
        | ScorePanelSortState
        | undefined
  );
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const setSort = useCallback(
    (sort: ScorePanelSortState) => {
      setPropertyValue(kScorePanelSortBag, kScorePanelSortKey, sort);
    },
    [setPropertyValue]
  );
  return [stored, setSort];
};

/**
 * Resolve the stored / eval-supplied / default sort.
 * Priority: user override (stored) > eval default > unsorted.
 */
export const resolveScorePanelSort = (
  stored: ScorePanelSortState | undefined,
  evalDefault: ScorePanelSortState | undefined
): ScorePanelSortState => stored ?? evalDefault ?? kDefaultScorePanelSort;

// The eval-author default mode was serialized under `view` and is now
// serialized under `default`; accept either so logs from either version
// resolve. The value is advisory, so a miss falls through to the
// count-based default downstream.
export const readEvalScorePanelView = (
  panel:
    | { default?: ScoreView | null; view?: ScoreView | null }
    | null
    | undefined
): ScoreView | undefined => panel?.default ?? panel?.view ?? undefined;

/**
 * Read the eval-author-declared default score-panel view from
 * `Task(viewer=ViewerConfig(sample_score_view=SampleScoreView(default=...)))`.
 * Returns a primitive so Zustand's reference equality is stable.
 */
export const useEvalScorePanelView = (): ScoreView | undefined =>
  readEvalScorePanelView(
    useSelectedLogDetails()?.eval.viewer?.sample_score_view
  );

/**
 * Read the eval-author-declared default score-panel sort. The raw
 * stored object reference is stable across renders (it lives on
 * `selectedLogDetails`); we normalize the nullable fields inside a
 * `useMemo` keyed on that reference to avoid feeding a fresh object
 * back into Zustand on every render.
 */
export const useEvalScorePanelSort = (): ScorePanelSortState | undefined => {
  const stored = useSelectedLogDetails()?.eval.viewer?.sample_score_view?.sort;
  return useMemo(() => {
    if (!stored) return undefined;
    return {
      column: stored.column ?? null,
      dir: stored.dir ?? "asc",
    };
  }, [stored]);
};

const log = createLogger("hooks");

/**
 * The details for the currently selected log, read from the react-query
 * `["log-details", logDir]` collection. Returns the settled value (or
 * `undefined` while loading / when no log is selected) — the drop-in for the
 * retired `log.selectedLogDetails`. Use `useLogDetail` directly for the
 * `AsyncData` (loading/error) surface.
 */
export const useSelectedLogDetails = (): LogDetails | undefined => {
  const logDir = useLogDir();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  return useLogDetail(logDir, selectedLogFile);
};

export const useEvalSpec = () => {
  return useSelectedLogDetails()?.eval;
};

/**
 * The selected log's running metrics — the selection binding over the
 * param-driven `useRunningMetrics` acquisition hook.
 */
export const useSelectedRunningMetrics = (): RunningMetric[] | undefined => {
  const logDir = useLogDir();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  return useRunningMetrics(logDir, selectedLogFile);
};

export interface LogEditAffordance {
  /** True when an edit can be initiated: server supports edits, a log is
   *  selected, and the recorder isn't still appending. */
  canEdit: boolean;
  /** The log file the edit would target, or undefined. */
  selectedLogFile: string | undefined;
  /** Call after a successful edit to re-read the log into the store. */
  refreshOnSave: () => void;
}

/**
 * Capability + plumbing for an edit-the-current-log surface (tag, metadata,
 * score, …). Each edit dialog kind reads this and renders its own dialog
 * with its own payload — but the gate and the refresh wiring are shared.
 *
 * The in-progress gate mirrors the server: the edit API returns 409 while
 * the recorder still owns the file, so offering the action and failing
 * on save is worse than not offering it.
 */
export const useLogEditAffordance = (): LogEditAffordance => {
  const api = getApi();
  const hasEditApi = Boolean(api.edit_log);
  const selectedLogFile = useStore((s) => s.logs.selectedLogFile);
  const logStatus = useSelectedLogDetails()?.status;
  const isInProgress = logStatus === "started";
  return {
    canEdit: hasEditApi && !!selectedLogFile && !isInProgress,
    selectedLogFile,
    refreshOnSave: refreshLog,
  };
};

/**
 * The selected log's sample summaries (completed and incomplete, unfiltered)
 * — the selection binding over the param-driven `useSampleSummaries`
 * acquisition hook.
 */
export const useSelectedSampleSummaries = (): SampleSummary[] => {
  const logDir = useLogDir();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  return useSampleSummaries(logDir, selectedLogFile);
};

// Counts the total number of unfiltered sample summaries (both complete and incomplete)
export const useTotalSampleCount = () => {
  const sampleSummaries = useSelectedSampleSummaries();
  return useMemo(() => {
    return sampleSummaries.length;
  }, [sampleSummaries]);
};

// Provides the currently selected score(s) for this eval, providing a default
// based upon the configuration (eval + summaries) if no scorer has been
// selected
export const useSelectedScores = () => {
  const selectedLogDetails = useSelectedLogDetails();
  const sampleSummaries = useSelectedSampleSummaries();
  const selected = useStore((state) => state.log.selectedScores);
  return useMemo(() => {
    if (selected !== undefined) {
      return selected;
    }
    if (selectedLogDetails) {
      return getAvailableScorers(selectedLogDetails, sampleSummaries) ?? [];
    }
    return [];
  }, [selectedLogDetails, sampleSummaries, selected]);
};

// Provides the list of available scorers. Will inspect the eval or samples
// to determine scores (even for in progress evals that don't yet have final
// metrics)
export const useScores = () => {
  const selectedLogDetails = useSelectedLogDetails();
  const sampleSummaries = useSelectedSampleSummaries();
  return useMemo(() => {
    if (!selectedLogDetails) {
      return [];
    }

    const result =
      getAvailableScorers(selectedLogDetails, sampleSummaries) || [];
    return result;
  }, [selectedLogDetails, sampleSummaries]);
};

// Provides the eval descriptor
export const useEvalDescriptor = () => {
  const scores = useScores();
  const sampleSummaries = useSelectedSampleSummaries();
  return useMemo(() => {
    return scores ? createEvalDescriptor(scores, sampleSummaries) : null;
  }, [scores, sampleSummaries]);
};

export const useSampleDescriptor = () => {
  const evalDescriptor = useEvalDescriptor();
  const sampleSummaries = useSelectedSampleSummaries();
  const selectedScores = useSelectedScores();
  return useMemo(() => {
    return evalDescriptor
      ? createSamplesDescriptor(sampleSummaries, evalDescriptor, selectedScores)
      : undefined;
  }, [evalDescriptor, sampleSummaries, selectedScores]);
};

// Sort key: sample id ascending (numeric when both numeric, else
// lexicographic), then epoch ascending. Extracted so the already-sorted
// pre-check shares the exact comparison the sort uses.
export const compareSamples = (a: SampleSummary, b: SampleSummary): number => {
  let idCompare: number;
  if (typeof a.id === "number" && typeof b.id === "number") {
    idCompare = a.id - b.id;
  } else {
    idCompare = String(a.id).localeCompare(String(b.id));
  }
  if (idCompare !== 0) {
    return idCompare;
  }
  return a.epoch - b.epoch;
};

// Server summaries usually arrive already sorted; this lets useFilteredSamples
// skip an O(n log n) clone + sort on every filter/store change.
export const samplesAreSorted = (samples: SampleSummary[]): boolean =>
  samples.every((curr, i) => {
    const prev = samples[i - 1];
    return prev === undefined || compareSamples(prev, curr) <= 0;
  });

// Provides the list of filtered and sorted samples
export const useFilteredSamples = () => {
  const samplesDescriptor = useSampleDescriptor();
  const sampleSummaries = useSelectedSampleSummaries();
  const filter = useStore((state) => state.log.filter);
  const setFilterError = useStore((state) => state.logActions.setFilterError);
  const clearFilterError = useStore(
    (state) => state.logActions.clearFilterError
  );

  return useMemo(() => {
    // Apply text filter
    const { result, error, allErrors } =
      samplesDescriptor && filter
        ? filterSamples(samplesDescriptor, sampleSummaries, filter)
        : { result: sampleSummaries, error: undefined, allErrors: false };

    if (error && allErrors) {
      setFilterError(error);
    } else {
      clearFilterError();
    }

    const filtered =
      error === undefined || !allErrors ? result : sampleSummaries;

    // Skip the clone + sort when the list is already ordered (the common case).
    if (filtered.length < 2 || samplesAreSorted(filtered)) {
      return filtered;
    }

    return [...filtered].sort(compareSamples);
  }, [
    samplesDescriptor,
    sampleSummaries,
    filter,
    setFilterError,
    clearFilterError,
  ]);
};

// Provides the currently selected sample summary
export const useSelectedSampleSummary = (): SampleSummary | undefined => {
  const sampleSummaries = useSelectedSampleSummaries();
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );
  return useMemo(() => {
    const selectedSampleSummary = sampleSummaries.find((sample) => {
      return (
        sampleIdsEqual(sample.id, selectedSampleHandle?.id) &&
        sample.epoch === selectedSampleHandle?.epoch
      );
    });

    return selectedSampleSummary;
  }, [selectedSampleHandle, sampleSummaries]);
};

/**
 * The selected sample's data — the selection binding over the param-driven
 * `useSampleData` acquisition hook.
 */
export const useSelectedSampleData = (): SampleData => {
  const logDir = useLogDir();
  const handle = useStore((state) => state.log.selectedSampleHandle);
  return useSampleData(logDir, handle);
};

/**
 * The selected sample's invalidation record (if any) — the selection binding
 * projecting from the param-driven `usePassiveEvalSample` acquisition hook.
 */
export const useSelectedSampleInvalidation = ():
  | EvalSample["invalidation"]
  | undefined =>
  usePassiveEvalSample(
    useLogDir(),
    useStore((state) => state.log.selectedSampleHandle)
  )?.invalidation ?? undefined;

export const useLogSelection = () => {
  const selectedSampleSummary = useSelectedSampleSummary();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const loadedLog = useStore((state) => state.log.loadedLog);

  return useMemo(() => {
    return {
      logFile: selectedLogFile,
      loadedLog: loadedLog,
      sample: selectedSampleSummary,
    };
  }, [loadedLog, selectedLogFile, selectedSampleSummary]);
};

export const useCollapseSampleEvent = (
  scope: string,
  id: string
): [boolean, (collapsed: boolean) => void] => {
  const collapsed = useStore((state) => state.sample.collapsedEvents);
  const collapseEvent = useStore((state) => state.sampleActions.collapseEvent);

  return useMemo(() => {
    const isCollapsed = collapsed !== null && collapsed[scope]?.[id] === true;
    const set = (value: boolean) => {
      log.debug("Set collapsed", id, value);
      collapseEvent(scope, id, value);
    };
    return [isCollapsed, set];
  }, [collapsed, scope, id, collapseEvent]);
};

export const useMessageVisibility = (
  id: string,
  scope: "sample" | "eval"
): [boolean, (visible: boolean) => void] => {
  const visible = useStore((state) =>
    state.appActions.getMessageVisible(id, true)
  );
  const setVisible = useStore((state) => state.appActions.setMessageVisible);
  const clearVisible = useStore(
    (state) => state.appActions.clearMessageVisible
  );

  // Track if this is the first render (rehydrate)
  const isFirstRender = useRef(true);

  // Reset state if the eval changes, but not during initialization
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  useEffect(() => {
    // Skip the first effect run
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    log.debug("clear message (eval)", id);
    clearVisible(id);
  }, [selectedLogFile, clearVisible, id]);

  // Maybe reset state if sample changes
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );

  useEffect(() => {
    // Skip the first effect run for sample changes too
    if (isFirstRender.current) {
      return;
    }

    if (scope === "sample") {
      log.debug("clear message (sample)", id);
      clearVisible(id);
    }
  }, [selectedSampleHandle, clearVisible, id, scope]);

  return useMemo(() => {
    log.debug("visibility", id, visible);
    const set = (visible: boolean) => {
      log.debug("set visiblity", id);
      setVisible(id, visible);
    };
    return [visible, set];
  }, [visible, setVisible, id]);
};

export const useSamplePopover = (id: string) => {
  const setVisiblePopover = useStore(
    (store) => store.sampleActions.setVisiblePopover
  );
  const clearVisiblePopover = useStore(
    (store) => store.sampleActions.clearVisiblePopover
  );
  const visiblePopover = useStore((store) => store.sample.visiblePopover);
  const timerRef = useRef<number | null>(null);

  const show = useCallback(() => {
    if (timerRef.current) {
      return; // Timer already running
    }

    timerRef.current = window.setTimeout(() => {
      setVisiblePopover(id);
      timerRef.current = null;
    }, 250);
  }, [id, setVisiblePopover]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    clearVisiblePopover();
  }, [clearVisiblePopover]);

  // Clear the timeout when component unmounts
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const isShowing = useMemo(() => {
    return visiblePopover === id;
  }, [id, visiblePopover]);

  return {
    show,
    hide,
    setShowing: (shouldShow: boolean) => {
      if (shouldShow) {
        show();
      } else {
        hide();
      }
    },
    isShowing,
  };
};

export const useLogsListing = () => {
  const filteredCount = useStore((state) => state.logs.listing.filteredCount);
  const setFilteredCount = useStore(
    (state) => state.logsActions.setFilteredCount
  );

  const gridStateByScope = useStore(
    (state) => state.logs.listing.gridStateByScope
  );
  const setGridState = useStore((state) => state.logsActions.setLogsGridState);
  const clearGridState = useStore(
    (state) => state.logsActions.clearLogsGridState
  );

  return {
    filteredCount,
    setFilteredCount,
    gridStateByScope,
    setGridState,
    clearGridState,
  };
};

const isActiveStatus = (status: EvalLogStatus | undefined) =>
  status === "started" || status === "success";

export type LogHandleWithretried = LogHandle & { retried?: boolean };

type LogPreviewStatusMap = Record<
  string,
  { status?: EvalLogStatus } | undefined
>;

/**
 * Pure dedup logic for {@link useLogsWithretried}.
 *
 * Groups logs by (parent directory, task_id) so that logs sharing a task_id
 * across different folders (e.g. copied log directories under a shared parent)
 * are not treated as retries of each other. Within each group, logs whose
 * status is `started` or `success` rank above other statuses; ties are
 * broken by filename descending so the newest run wins. The winner is
 * marked `retried: false`; the rest are marked `retried: true`.
 */
export const computeLogsWithRetried = (
  logs: LogHandle[],
  logPreviews: LogPreviewStatusMap
): LogHandleWithretried[] => {
  const logsByGroup = logs.reduce(
    (acc: Record<string, LogHandleWithretried[]>, log) => {
      const taskId = log.task_id;
      if (taskId) {
        const slash = log.name.lastIndexOf("/");
        const parent = slash >= 0 ? log.name.substring(0, slash) : "";
        const key = `${parent}|${taskId}`;
        if (!(key in acc)) acc[key] = [];
        // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
        acc[key].push(log);
      }
      return acc;
    },
    {}
  );
  // For each group, select the best item: prefer logs whose status is
  // started or success (treated as equivalent — both mean "not failed"),
  // then break ties by filename descending so the newest run wins.
  // An older `started` log is treated as orphaned once a newer log exists.
  const bestByName: Record<string, LogHandleWithretried> = {};
  for (const items of Object.values(logsByGroup)) {
    items.sort((a, b) => {
      const aActive = isActiveStatus(logPreviews[a.name]?.status);
      const bActive = isActiveStatus(logPreviews[b.name]?.status);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.name.localeCompare(a.name);
    });
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    const { name } = items[0];
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    bestByName[name] = { ...items[0], retried: false }; // eslint-disable-line @typescript-eslint/no-unsafe-member-access -- TODO: pre-existing noUncheckedIndexedAccess fallout
  }

  // Rebuild logs maintaining order, marking duplicates as skippable
  return logs.map(
    (log) =>
      bestByName[log.name] ?? {
        ...log,
        // task_id is optional for backward compatibility, only new logs files can be skippable
        retried: log.task_id ? true : undefined,
      }
  );
};

export const useLogsWithretried = (): LogHandleWithretried[] => {
  const logDir = useLogDir();
  const logs = useLogHandles(logDir);
  const logPreviews = useLogPreviews(logDir);

  return useMemo(
    () => computeLogsWithRetried(logs, logPreviews),
    [logs, logPreviews]
  );
};
