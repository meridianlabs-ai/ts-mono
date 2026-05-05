import type { FilterModel } from "ag-grid-community";

import type {
  SamplesColumn,
  SamplesSort,
  SamplesView,
} from "@tsmono/inspect-common/types";

/**
 * Wire shapes — generated from the Python Pydantic models in
 * `src/inspect_ai/viewer/_config.py`. These mirror what an eval author
 * writes via `Task(viewer=ViewerConfig(task_samples_view=...))` and
 * what the eval log carries through to the frontend.
 *
 * `SamplesView.filter` is a raw DSL expression string.
 *
 * Re-exported here for convenience so SampleList code can import every
 * samples-view type from a single module.
 */
export type { SamplesColumn, SamplesSort, SamplesView };

/**
 * Runtime descriptor — what the inspect app's SampleList store holds
 * and what the future `useSamplesView` hook returns. Resolves nullable
 * wire fields and adds ag-grid filterModel residue (`extraColumnFilters`)
 * for any column-header filter that isn't expressible in the DSL.
 *
 * `extraColumnFilters` is TS-only. It is never serialized to Python
 * and never appears on the wire; eval authors describe defaults via
 * `SamplesView.filter` (a DSL string).
 */
export interface SamplesViewState {
  name: string;
  /** Single ordered list — position is display order. */
  columns: Array<{ id: string; visible: boolean }>;
  /** Multi-column sort, applied in array order. */
  sort: Array<{ colId: string; dir: "asc" | "desc" }>;
  filters: {
    /** Canonical filter expression. Empty string = no DSL filter. */
    dsl: string;
    /**
     * ag-grid filter entries for columns whose filter isn't expressible
     * as DSL (typed-set selectors, regex on raw string columns, etc.).
     * Derived at write time from the live `filterModel`; round-trippable
     * entries are excluded so we don't store the same predicate twice.
     */
    extraColumnFilters: FilterModel;
  };
  /**
   * Row layout. `true` = list-style multi-line rows (88px);
   * `false` = compact single-line rows (30px).
   */
  multiline: boolean;
  /**
   * Score-column presentation. `true` = compact narrow columns with
   * rotated 45° headers; `false` = standard-width horizontal headers.
   */
  compactScores: boolean;
  /**
   * Whether the score-cell colour-scale heatmap is currently on.
   * Only consulted when the eval has at least one entry in
   * `score_color_scales`; the toolbar hides its toggle otherwise.
   */
  colorScalesEnabled: boolean;
}

/**
 * The default view applied when neither the user nor the eval author
 * has specified anything. `columns` and `sort` are intentionally empty —
 * the SampleList consumer fills them from the live column registry
 * (`buildSampleColumns`) and seeds visibility from per-scope predicates
 * (e.g. `samplesPanel`'s error/limit/retries auto-promotion).
 */
export const defaultSamplesView = (): SamplesViewState => ({
  name: "Default",
  columns: [],
  sort: [],
  filters: { dsl: "", extraColumnFilters: {} },
  multiline: true,
  compactScores: false,
  colorScalesEnabled: true,
});
