import { isInDirectory } from "@tsmono/util";

import type { LogListingRow } from "../../log_data";
import { directoryRelativeUrl, join } from "../../utils/uri";
import { logsUrl, tasksUrl } from "../routing/url";

import type { FileLogItem } from "./LogItem";
import type { LogsPanelMode } from "./LogsPanel";

/** The view inputs that determine a log's file item (and whether it has one). */
export interface FileLogItemView {
  mode: LogsPanelMode;
  logDir: string;
  /** The directory being listed (folder mode lists it; tasks mode ignores it
   *  and lists the whole `logDir`). */
  currentDir: string;
  showRetriedLogs: boolean;
}

const rootName = (relativePath: string) => relativePath.split("/")[0] ?? "";

/**
 * Map a listing row to the file item it displays as under `view`, or
 * `undefined` when the view has no file row for it: a retried run while
 * retried logs are hidden, or (folder mode) a file that isn't directly in
 * the current directory (it displays through its folder instead).
 *
 * This is the row-universe membership + identity function for the log list:
 * LogsPanel builds its items through it, and the listing query applies it to
 * database records, so the two can never disagree about which files are rows.
 */
export const fileLogItem = (
  logFile: LogListingRow,
  view: FileLogItemView
): FileLogItem | undefined => {
  if (!view.showRetriedLogs && logFile.retried) return undefined;

  if (view.mode === "tasks") {
    const relativePath = directoryRelativeUrl(logFile.name, view.logDir);
    const decodedPath = decodeURIComponent(relativePath);
    return {
      id: logFile.name,
      name: decodedPath,
      type: "file",
      url: tasksUrl(decodedPath, view.logDir),
      log: logFile,
    };
  }

  const cleanDir = view.currentDir.endsWith("/")
    ? view.currentDir.slice(0, -1)
    : view.currentDir;
  if (!isInDirectory(logFile.name, cleanDir)) return undefined;

  const dirName = directoryRelativeUrl(view.currentDir, view.logDir);
  const relativePath = directoryRelativeUrl(logFile.name, view.currentDir);
  const fileOrFolderName = decodeURIComponent(rootName(relativePath));
  const path = join(
    decodeURIComponent(relativePath),
    decodeURIComponent(dirName)
  );
  return {
    id: fileOrFolderName,
    name: fileOrFolderName,
    type: "file",
    url: logsUrl(path, view.logDir),
    log: logFile,
  };
};
