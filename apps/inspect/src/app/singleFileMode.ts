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
