import { dirname } from "@tsmono/util";

import { ClientAPI } from "../client/api/types";

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
 * Resolve a single-file reference to its directory, against the page when the
 * ref is a bare basename. Always defined: a relative ref resolves against
 * `document.baseURI` (the folder serving the page — the same base static-http
 * uses), so `dirname` is never empty.
 */
const pageBaseDir = (fileRef: string): string =>
  dirname(new URL(fileRef, document.baseURI).href);

/**
 * The log dir for a single-file session. In single-file mode we don't ask the
 * server for the log root (which would walk the whole directory); we resolve it
 * from the file itself: its own directory if it has one, else the backend's
 * configured dir, else the page folder. Always defined — never the dishonest
 * empty-string sentinel.
 */
export const resolveSingleFileLogDir = async (
  fileRef: string,
  api: ClientAPI
): Promise<string> => {
  const own = dirname(fileRef);
  if (own !== "") return own;
  const fromApi = await api.get_log_dir?.();
  if (fromApi) return fromApi;
  return pageBaseDir(fileRef);
};

/** Synchronous resolution for the embedded/VS Code seed (URLs are absolute). */
export const resolveEmbeddedLogDir = (fileRef: string): string => {
  const own = dirname(fileRef);
  return own !== "" ? own : pageBaseDir(fileRef);
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
