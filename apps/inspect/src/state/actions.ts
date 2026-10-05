// Plain-function actions: fire-and-forget mutations that read current state
// at call time. These need none of React's machinery — a hook is warranted
// only when the callback's identity must change with reactive inputs and
// consumers need to re-render on that change (see e.g. the navigation hooks).

import { EvalSample, EvalSpec } from "@tsmono/inspect-common/types";
import { prettyDirUri } from "@tsmono/util";

import { getAppConfig, resolveRouteLogFile } from "../app_config";
import { imperativeLogData } from "../log_data";

import { storeImplementation, StoreState } from "./store";

const state = (): StoreState => {
  if (!storeImplementation) {
    throw new Error("Store accessed before initialization.");
  }
  return storeImplementation.getState();
};

/** Remember a grid highlight independently of the sample currently open. */
export const highlightSample = (
  sampleId: string | number,
  epoch: number,
  logFile: string
) => {
  state().logActions.highlightSample(
    sampleId,
    epoch,
    resolveRouteLogFile(logFile)
  );
};

/** Re-fetch the selected log's details and reset filtering. */
export const refreshLog = (logFile: string | undefined) => {
  imperativeLogData.invalidateLogDetail(getAppConfig().logDir, logFile);
  state().logActions.resetFiltering();
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
