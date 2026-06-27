import { dirname, getVscodeApi } from "@tsmono/util";

import { hasApprovedSingleFileMode } from "../client/api/log-location";

/**
 * Single-file mode is set when the viewer is opened against a specific log
 * rather than a directory listing — e.g. an embedded iframe deep-link. We
 * need to know this before the first render so that AppRouter renders the
 * log view directly instead of mounting LogsPanel, which would otherwise
 * kick off directory-wide replication for every log in the directory.
 */
export const detectInitialSingleFileMode = (
  doc: Pick<Document, "getElementById">,
  approvedFileSelection = hasApprovedSingleFileMode(),
  hasHostApi = !!getVscodeApi()
): boolean => {
  if (hasHostApi && doc.getElementById("logview-state")) {
    return true;
  }
  return approvedFileSelection;
};

/**
 * In single-file mode we don't ask the server for the log root (which would
 * walk the whole directory) — we derive the log dir from the selected file.
 */
export const deriveSingleFileLogDir = (
  logFile: string | undefined
): string | undefined => {
  if (!logFile) return undefined;
  const dir = dirname(logFile);
  return dir === "" ? undefined : dir;
};

/**
 * Single-file mode becomes active only for a trusted host/file bootstrap or
 * after the location controller validates or explicitly approves a file.
 */
export const isSingleFileMode = (): boolean =>
  typeof window !== "undefined" ? detectInitialSingleFileMode(document) : false;
