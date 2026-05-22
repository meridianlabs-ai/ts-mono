import { dirname } from "@tsmono/util";

/**
 * Single-file mode is set when the viewer is opened against a specific log
 * rather than a directory listing — e.g. an embedded iframe deep-link. We
 * need to know this before the first render so that AppRouter renders the
 * log view directly instead of mounting LogsPanel, which would otherwise
 * kick off directory-wide replication for every log in the directory.
 */
export const detectInitialSingleFileMode = (
  location: { search: string },
  doc: Pick<Document, "getElementById">
): boolean => {
  if (doc.getElementById("logview-state")) {
    return true;
  }
  const params = new URLSearchParams(location.search);
  return params.has("log_file") || params.has("task_file");
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
 * Resolved once at module import. Whether the viewer is in single-file mode
 * is a startup-time property: it's a function of the URL the page loaded with
 * (or embedded state injected by VSCode) and never flips during the session,
 * so we don't need to thread it through application state.
 */
export const isSingleFileMode: boolean =
  typeof window !== "undefined"
    ? detectInitialSingleFileMode(window.location, document)
    : false;
