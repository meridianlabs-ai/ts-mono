import type { FilterModel, GridState } from "ag-grid-community";
import { describe, expect, test } from "vitest";

import type { SamplesView } from "@tsmono/inspect-common/types";

import { defaultSamplesView, type SamplesViewState } from "./samplesView";
import {
  flattenToEvalView,
  gridStateToView,
  legacyToView,
  liftEvalView,
  mergeColumnVisibility,
  partitionFilterModel,
  pickActiveView,
  resolveSamplesView,
  viewToGridState,
  type LegacyScopeState,
} from "./samplesView.converters";

const cols = (...ids: string[]) => new Set(ids);

const sampleState = (
  overrides: Partial<SamplesViewState> = {}
): SamplesViewState => ({
  ...defaultSamplesView(),
  ...overrides,
});

describe("liftEvalView", () => {
  test("undefined / null wire collapses to the built-in default", () => {
    expect(liftEvalView(undefined)).toEqual(defaultSamplesView());
    expect(liftEvalView(null)).toEqual(defaultSamplesView());
  });

  test("nullable wire fields collapse to defaults; explicit fields pass through", () => {
    const wire: SamplesView = {
      name: "Triage",
      columns: [
        { id: "input", visible: true },
        { id: "target", visible: false },
      ],
      sort: [{ column: "tokens", dir: "desc" }],
      filter: "has_error",
      multiline: false,
    };
    expect(liftEvalView(wire)).toEqual({
      name: "Triage",
      columns: [
        { id: "input", visible: true },
        { id: "target", visible: false },
      ],
      sort: [{ colId: "tokens", dir: "desc" }],
      filters: { dsl: "has_error", extraColumnFilters: {} },
      multiline: false,
      compactScores: false,
    });
  });

  test("missing columns / sort fall back to default (empty arrays today)", () => {
    const wire: SamplesView = { name: "Default" };
    const lifted = liftEvalView(wire);
    expect(lifted.columns).toEqual([]);
    expect(lifted.sort).toEqual([]);
    expect(lifted.filters).toEqual({ dsl: "", extraColumnFilters: {} });
    expect(lifted.multiline).toBe(true);
    expect(lifted.compactScores).toBe(false);
  });

  test("compact_scores wire field maps to compactScores runtime field", () => {
    const wire: SamplesView = { name: "Triage", compact_scores: true };
    expect(liftEvalView(wire).compactScores).toBe(true);
  });
});

describe("flattenToEvalView", () => {
  test("strips extraColumnFilters and rewrites colId → column", () => {
    const state = sampleState({
      name: "Errors",
      columns: [{ id: "input", visible: true }],
      sort: [{ colId: "tokens", dir: "asc" }],
      filters: {
        dsl: "has_error",
        extraColumnFilters: { input: { type: "contains", filter: "abc" } },
      },
      multiline: false,
    });
    expect(flattenToEvalView(state)).toEqual({
      name: "Errors",
      columns: [{ id: "input", visible: true }],
      sort: [{ column: "tokens", dir: "asc" }],
      filter: "has_error",
      multiline: false,
      compact_scores: false,
    });
  });

  test("empty dsl renders as filter: null on the wire", () => {
    expect(
      flattenToEvalView(sampleState({ name: "Default" })).filter
    ).toBeNull();
  });
});

describe("pickActiveView", () => {
  const view: SamplesView = { name: "A" };

  test("undefined / null → undefined", () => {
    expect(pickActiveView(undefined)).toBeUndefined();
    expect(pickActiveView(null)).toBeUndefined();
  });

  test("bare object passes through", () => {
    expect(pickActiveView(view)).toBe(view);
  });

  test("list returns the first entry", () => {
    const second: SamplesView = { name: "B" };
    expect(pickActiveView([view, second])).toBe(view);
  });

  test("empty list yields undefined", () => {
    expect(pickActiveView([])).toBeUndefined();
  });
});

describe("resolveSamplesView precedence", () => {
  test("user-stored state wins outright", () => {
    const stored = sampleState({ name: "User" });
    const evalDefault: SamplesView = { name: "Eval" };
    expect(resolveSamplesView(stored, evalDefault)).toBe(stored);
  });

  test("eval default applies when no stored state is present", () => {
    const evalDefault: SamplesView = { name: "Eval", multiline: false };
    expect(resolveSamplesView(undefined, evalDefault)).toEqual(
      liftEvalView(evalDefault)
    );
  });

  test("falls through to built-in default when neither is present", () => {
    expect(resolveSamplesView(undefined, undefined)).toEqual(
      defaultSamplesView()
    );
  });
});

describe("viewToGridState", () => {
  test("emits ag-grid columnVisibility / columnOrder / sort / filter", () => {
    const state = sampleState({
      columns: [
        { id: "status", visible: true },
        { id: "input", visible: true },
        { id: "target", visible: false },
        { id: "tokens", visible: true },
      ],
      sort: [{ colId: "tokens", dir: "desc" }],
      filters: {
        dsl: "ignored — dsl is materialized by the caller in Phase 2",
        extraColumnFilters: { input: { type: "contains", filter: "abc" } },
      },
    });
    const gs = viewToGridState(
      state,
      cols("status", "input", "target", "tokens")
    );
    expect(gs.columnVisibility?.hiddenColIds).toEqual(["target"]);
    expect(gs.columnOrder?.orderedColIds).toEqual([
      "status",
      "input",
      "target",
      "tokens",
    ]);
    expect(gs.sort?.sortModel).toEqual([{ colId: "tokens", sort: "desc" }]);
    expect(gs.filter?.filterModel).toEqual({
      input: { type: "contains", filter: "abc" },
    });
  });

  test("excludes unknown column ids from columns / sort / extras", () => {
    const state = sampleState({
      columns: [
        { id: "input", visible: true },
        { id: "score__judge__correctness", visible: true },
      ],
      sort: [{ colId: "score__judge__correctness", dir: "asc" }],
      filters: {
        dsl: "",
        extraColumnFilters: {
          score__judge__correctness: { type: "equals", filter: 1 },
        },
      },
    });
    const gs = viewToGridState(state, cols("input"));
    expect(gs.columnOrder?.orderedColIds).toEqual(["input"]);
    expect(gs.sort?.sortModel).toEqual([]);
    expect(gs.filter?.filterModel).toEqual({});
  });

  test("does NOT mutate the source descriptor when filtering", () => {
    const state = sampleState({
      columns: [{ id: "score__judge__correctness", visible: true }],
      sort: [{ colId: "score__judge__correctness", dir: "asc" }],
    });
    const before = JSON.stringify(state);
    viewToGridState(state, cols("input"));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("gridStateToView", () => {
  const baseState: SamplesViewState = sampleState({
    columns: [
      { id: "input", visible: true },
      { id: "score__missing", visible: true },
    ],
    sort: [{ colId: "score__missing", dir: "asc" }],
    filters: {
      dsl: "has_error",
      extraColumnFilters: { score__missing: { type: "equals", filter: 1 } },
    },
  });

  test("rebuilds columns / sort / extras from a fresh GridState", () => {
    const gridState: GridState = {
      columnOrder: { orderedColIds: ["input", "tokens"] },
      columnVisibility: { hiddenColIds: ["tokens"] },
      sort: { sortModel: [{ colId: "input", sort: "desc" }] },
      filter: { filterModel: { input: { type: "contains", filter: "abc" } } },
    };
    const next = gridStateToView(baseState, gridState, cols("input", "tokens"));
    expect(next.columns).toEqual([
      { id: "input", visible: true },
      { id: "tokens", visible: false },
      // Unknown id from prev preserved, in unknown-tail position
      { id: "score__missing", visible: true },
    ]);
    expect(next.sort).toEqual([
      { colId: "input", dir: "desc" },
      { colId: "score__missing", dir: "asc" },
    ]);
    expect(next.filters.extraColumnFilters).toEqual({
      input: { type: "contains", filter: "abc" },
      score__missing: { type: "equals", filter: 1 },
    });
  });

  test("preserves prev.filters.dsl (caller owns the DSL/extra split)", () => {
    const gridState: GridState = { filter: { filterModel: {} } };
    const next = gridStateToView(baseState, gridState, cols("input"));
    expect(next.filters.dsl).toBe("has_error");
  });

  test("missing GridState fields produce empty arrays / objects", () => {
    const next = gridStateToView(baseState, {}, cols("input"));
    expect(next.columns).toEqual([
      // Unknown id from prev still preserved (column-id tolerance).
      { id: "score__missing", visible: true },
    ]);
    expect(next.sort).toEqual([{ colId: "score__missing", dir: "asc" }]);
    expect(next.filters.extraColumnFilters).toEqual({
      score__missing: { type: "equals", filter: 1 },
    });
  });
});

describe("mergeColumnVisibility", () => {
  test("overrides only the ids present in the visibility map", () => {
    const state = sampleState({
      columns: [
        { id: "a", visible: true },
        { id: "b", visible: false },
        { id: "c", visible: true },
      ],
    });
    const next = mergeColumnVisibility(state, { a: false, c: false });
    expect(next.columns).toEqual([
      { id: "a", visible: false },
      { id: "b", visible: false },
      { id: "c", visible: false },
    ]);
  });

  test("ignores unknown ids in the visibility map", () => {
    const state = sampleState({ columns: [{ id: "a", visible: true }] });
    const next = mergeColumnVisibility(state, { a: false, ghost: true });
    expect(next.columns).toEqual([{ id: "a", visible: false }]);
  });

  test("returns a new object — does not mutate input", () => {
    const state = sampleState({ columns: [{ id: "a", visible: true }] });
    const next = mergeColumnVisibility(state, { a: false });
    expect(state.columns[0].visible).toBe(true);
    expect(next).not.toBe(state);
  });
});

describe("partitionFilterModel", () => {
  // Stub decider: round-trippable iff colId starts with "ok_". The
  // returned DSL fragment is `<colId> ~ <type>`. Real callers wire this
  // to filterModelToText.
  const stubToDsl = (colId: string, entry: FilterModel[string]) => {
    if (colId.startsWith("ok_")) {
      const e = entry as { type?: string };
      return `${colId} ~ ${e.type ?? "?"}`;
    }
    return null;
  };

  test("empty / null model yields empty dsl + empty extras", () => {
    expect(partitionFilterModel(null, stubToDsl)).toEqual({
      dsl: "",
      extra: {},
    });
    expect(partitionFilterModel(undefined, stubToDsl)).toEqual({
      dsl: "",
      extra: {},
    });
    expect(partitionFilterModel({}, stubToDsl)).toEqual({ dsl: "", extra: {} });
  });

  test("round-trippable entries become an ANDed dsl string", () => {
    const model: FilterModel = {
      ok_a: { type: "equals", filter: 1 },
      ok_b: { type: "contains", filter: "x" },
    };
    expect(partitionFilterModel(model, stubToDsl)).toEqual({
      dsl: "ok_a ~ equals and ok_b ~ contains",
      extra: {},
    });
  });

  test("non-round-trippable entries land in `extra`", () => {
    const model: FilterModel = {
      ok_a: { type: "equals", filter: 1 },
      bad_b: { type: "regex", filter: ".*" },
    };
    expect(partitionFilterModel(model, stubToDsl)).toEqual({
      dsl: "ok_a ~ equals",
      extra: { bad_b: { type: "regex", filter: ".*" } },
    });
  });

  test("entries with empty-string DSL output are dropped from dsl but not extras", () => {
    const dropEmpty = (_colId: string, _entry: FilterModel[string]) => "";
    const model: FilterModel = { a: { type: "equals", filter: 1 } };
    expect(partitionFilterModel(model, dropEmpty)).toEqual({
      dsl: "",
      extra: {},
    });
  });
});

describe("legacyToView", () => {
  test("empty / missing slot yields the built-in default", () => {
    expect(legacyToView(undefined, undefined)).toEqual(defaultSamplesView());
    expect(legacyToView({}, "")).toEqual(defaultSamplesView());
  });

  test("merges columnOrder + columnVisibility into ordered columns[]", () => {
    const slot: LegacyScopeState = {
      columnVisibility: { input: true, target: false },
      gridState: {
        columnOrder: { orderedColIds: ["input", "target"] },
        columnVisibility: { hiddenColIds: ["target"] },
      },
    };
    const view = legacyToView(slot, undefined);
    expect(view.columns).toEqual([
      { id: "input", visible: true },
      { id: "target", visible: false },
    ]);
  });

  test("appends visibility-map keys not in columnOrder, in map insertion order", () => {
    const slot: LegacyScopeState = {
      columnVisibility: { extra1: true, extra2: false, input: true },
      gridState: {
        columnOrder: { orderedColIds: ["input"] },
      },
    };
    const view = legacyToView(slot, undefined);
    expect(view.columns).toEqual([
      { id: "input", visible: true },
      { id: "extra1", visible: true },
      { id: "extra2", visible: false },
    ]);
  });

  test("carries over sort + filterModel as extras; copies DSL filter from parallel arg", () => {
    const slot: LegacyScopeState = {
      gridState: {
        sort: { sortModel: [{ colId: "tokens", sort: "desc" }] },
        filter: {
          filterModel: { tokens: { type: "greaterThan", filter: 100 } },
        },
      },
    };
    const view = legacyToView(slot, "has_error");
    expect(view.sort).toEqual([{ colId: "tokens", dir: "desc" }]);
    expect(view.filters).toEqual({
      dsl: "has_error",
      extraColumnFilters: { tokens: { type: "greaterThan", filter: 100 } },
    });
  });
});
