// Plain-function actions: fire-and-forget mutations that read current state
// at call time. These need none of React's machinery — a hook is warranted
// only when the callback's identity must change with reactive inputs and
// consumers need to re-render on that change (see e.g. the navigation hooks).

import { EvalSample, EvalSpec } from "@tsmono/inspect-common/types";
import { createLogger } from "@tsmono/util";

import { getAppConfig } from "../app_config";
import { syncLogs } from "../log_data";
import { isUri, join, prettyDirUri } from "../utils/uri";

import { invalidateSelectedLog } from "./selectedLogDetails";
import { storeImplementation, StoreState } from "./store";

const log = createLogger("actions");

const state = (): StoreState => {
  if (!storeImplementation) {
    throw new Error("Store accessed before initialization.");
  }
  return storeImplementation.getState();
};

/** Select a log file, absolutizing a relative name against the resolved log
 *  dir (the slice stores only the absolute path). */
export const selectLogFile = (logFile: string) => {
  state().logsActions.setSelectedLogFile(
    isUri(logFile) ? logFile : join(logFile, getAppConfig().logDir)
  );
};

/** Clear the selected/loaded log. */
export const unloadLog = () => {
  const s = state();
  s.logsActions.clearSelectedLogFile();
  s.logActions.clearLog();
};

/** Re-fetch the selected log's details and reset filtering. */
export const refreshLog = () => {
  void invalidateSelectedLog(
    getAppConfig().logDir,
    state().logs.selectedLogFile
  );
  state().logActions.resetFiltering();
};

/** Refresh the log listing, logging failures. */
export const loadLogs = async () => {
  await syncLogs().catch((e) => {
    log.error("Error loading logs", e);
  });
};

export interface TitleContext {
  logDir?: string;
  evalSpec?: EvalSpec;
  sample?: EvalSample;
}

/** Set the document title from a log/sample context. */
export const setDocumentTitle = (context: TitleContext) => {
  const title: string[] = [];

  if (context.sample) {
    title.push(`${context.sample.id}_${context.sample.epoch}`);
  }

  if (context.evalSpec) {
    title.push(`${context.evalSpec.model} - ${context.evalSpec.task}`);
  }

  if (context.logDir) {
    title.push(prettyDirUri(context.logDir));
  }

  if (title.length === 0) {
    title.push("Inspect View");
  }

  document.title = title.join(" - ");
};
