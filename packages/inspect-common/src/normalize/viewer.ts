import { isRecord, nullProtoRecord } from "@tsmono/util";

/**
 * Normalize a raw `EvalSpec.viewer`, filling the defaults pydantic's
 * `inspect_ai.viewer._config` models apply at read time. Scanner-result
 * field entries whose `kind` is neither `builtin` nor `metadata` (only a
 * hand-edited log carries them) are dropped, since no renderer can place them.
 */
export const normalizeViewerConfig = (
  raw: Record<string, unknown>
): Record<string, unknown> => {
  const viewer = { ...raw };
  viewer["scanner_result_view"] = normalizeScannerResultViews(
    viewer["scanner_result_view"]
  );
  const scoreView = viewer["sample_score_view"];
  if (isRecord(scoreView) && isRecord(scoreView["sort"])) {
    viewer["sample_score_view"] = {
      ...scoreView,
      sort: withSortDir(scoreView["sort"]),
    };
  }
  const samplesView = viewer["task_samples_view"];
  if (Array.isArray(samplesView)) {
    viewer["task_samples_view"] = (samplesView as unknown[]).map(
      normalizeTaskSamplesView
    );
  } else if (samplesView != null) {
    viewer["task_samples_view"] = normalizeTaskSamplesView(samplesView);
  }
  return viewer;
};

const withSortDir = (sort: Record<string, unknown>) => ({
  ...sort,
  dir: sort["dir"] === "desc" ? "desc" : "asc",
});

const normalizeTaskSamplesView = (raw: unknown): unknown => {
  if (!isRecord(raw)) return raw;
  const view = { ...raw };
  const columns = view["columns"];
  if (Array.isArray(columns)) {
    view["columns"] = (columns as unknown[]).map((column) =>
      isRecord(column)
        ? {
            ...column,
            visible:
              typeof column["visible"] === "boolean" ? column["visible"] : true,
          }
        : column
    );
  }
  const sort = view["sort"];
  if (Array.isArray(sort)) {
    view["sort"] = (sort as unknown[]).map((entry) =>
      isRecord(entry) ? withSortDir(entry) : entry
    );
  }
  return view;
};

// A bare `ScannerResultView` is shorthand for `{"*": view}`; it is told apart
// from the glob-keyed map the same way the Python side and the resolver do.
const normalizeScannerResultViews = (raw: unknown): Record<string, unknown> => {
  if (!isRecord(raw)) return {};
  if ("fields" in raw || "exclude_fields" in raw) {
    return normalizeScannerResultView(raw);
  }
  const views = new Map<string, Record<string, unknown>>();
  for (const [pattern, view] of Object.entries(raw)) {
    if (isRecord(view)) views.set(pattern, normalizeScannerResultView(view));
  }
  return nullProtoRecord(views);
};

const normalizeScannerResultView = (
  raw: Record<string, unknown>
): Record<string, unknown> => ({
  ...raw,
  fields: Array.isArray(raw["fields"])
    ? normalizeFieldEntries(raw["fields"])
    : null,
  exclude_fields: Array.isArray(raw["exclude_fields"])
    ? normalizeFieldEntries(raw["exclude_fields"])
    : [],
});

const normalizeFieldEntries = (entries: unknown[]): unknown[] =>
  entries.flatMap((entry): unknown[] => {
    if (typeof entry === "string") return [entry];
    if (
      !isRecord(entry) ||
      (entry["kind"] !== "builtin" && entry["kind"] !== "metadata")
    ) {
      return [];
    }
    const collapsed = entry["collapsed"];
    return [
      { ...entry, collapsed: typeof collapsed === "boolean" && collapsed },
    ];
  });
