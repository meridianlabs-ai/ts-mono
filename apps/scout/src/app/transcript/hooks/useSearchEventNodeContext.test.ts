// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestWrapperWithStore } from "../../../test/test-utils";
import type { Reference, Result } from "../../../types/api-types";
import { getSearchPanelStateKey } from "../searchPanelState";

import { useSearchEventNodeContext } from "./useSearchEventNodeContext";

const transcriptDir = "/tmp/transcripts";
const transcriptId = "sample-transcript";

const seedSearchResult = (
  store: ReturnType<typeof createTestWrapperWithStore>["store"],
  result: Result,
  overrides?: { hasSearched?: boolean }
) => {
  const key = getSearchPanelStateKey({
    scope: "events",
    transcriptDir,
    transcriptId,
  });
  act(() => {
    store.getState().setSearchPanelState(key, (prev) => ({
      ...prev,
      searchType: "llm",
      searches: {
        ...prev.searches,
        llm: {
          ...prev.searches.llm,
          currentSearch: result,
          hasSearched: overrides?.hasSearched ?? true,
        },
      },
    }));
  });
};

const buildReferences = (refs: Reference[]): Result => ({
  value: refs.length,
  references: refs,
});

describe("useSearchEventNodeContext", () => {
  it("returns undefined when transcriptDir is missing (no key, no work)", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([{ id: "msg-1", type: "message", cite: "[1]" }])
    );

    const { result } = renderHook(
      () =>
        useSearchEventNodeContext({
          scope: "events",
          transcriptDir: undefined,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toBeUndefined();
  });

  it("returns undefined while the active search has not been run", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([{ id: "msg-1", type: "message", cite: "[1]" }]),
      { hasSearched: false }
    );

    const { result } = renderHook(
      () =>
        useSearchEventNodeContext({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toBeUndefined();
  });

  it("returns messageLabels for message references with a cite", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([
        { id: "msg-1", type: "message", cite: "[1]" },
        { id: "msg-2", type: "message", cite: "[2]" },
      ])
    );

    const { result } = renderHook(
      () =>
        useSearchEventNodeContext({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({
      messageLabels: { "msg-1": "[1]", "msg-2": "[2]" },
    });
  });

  it("filters out event references and refs missing a cite", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([
        { id: "msg-1", type: "message", cite: "[1]" },
        { id: "msg-2", type: "message" },
        { id: "evt-1", type: "event", cite: "[ignored]" },
      ])
    );

    const { result } = renderHook(
      () =>
        useSearchEventNodeContext({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({ messageLabels: { "msg-1": "[1]" } });
  });

  it("returns undefined when the result has no message references", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([{ id: "evt-1", type: "event", cite: "[1]" }])
    );

    const { result } = renderHook(
      () =>
        useSearchEventNodeContext({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toBeUndefined();
  });

  it("isolates state across (scope, transcriptDir, transcriptId) keys", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    // Seed a result on the events scope.
    seedSearchResult(
      store,
      buildReferences([{ id: "msg-1", type: "message", cite: "[events]" }])
    );

    // The messages-scope hook reads a different key — should see no labels.
    const { result } = renderHook(
      () =>
        useSearchEventNodeContext({
          scope: "messages",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toBeUndefined();
  });
});
