/**
 * The viewer's log source as named by URL params. `?log_dir=` (a directory) and
 * `?log_file=` (a single file) are mutually exclusive intents, so this is the one
 * parse of both: it collapses them into a discriminated union and throws on the
 * contradictory combination, leaving backend selection and single-file detection
 * a clean either/or they can't disagree on or misuse.
 */
export type UrlLogSource =
  | { kind: "dir"; logDir: string }
  | { kind: "file"; logFile: string }
  | { kind: "none" };

export const parseUrlLogSource = (search: string): UrlLogSource => {
  const params = new URLSearchParams(search);
  const logDir = params.get("log_dir");
  const logFile = params.get("log_file");
  if (logDir !== null && logFile !== null) {
    throw new Error(
      "?log_dir= and ?log_file= are mutually exclusive (a directory vs. a single file); pass only one."
    );
  }
  if (logFile !== null) return { kind: "file", logFile };
  if (logDir !== null) return { kind: "dir", logDir };
  return { kind: "none" };
};
