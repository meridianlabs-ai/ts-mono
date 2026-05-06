// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestWrapperWithStore } from "../../../test/test-utils";
import type { Reference, Result } from "../../../types/api-types";
import { getSearchPanelStateKey } from "../searchPanelState";
import type { SearchType } from "../searchRequest";

import { useSearchReferenceLabels } from "./useSearchReferenceLabels";

const transcriptDir = "/tmp/transcripts";
const transcriptId = "sample-transcript";

const seedSearchResult = (
  store: ReturnType<typeof createTestWrapperWithStore>["store"],
  result: Result,
  overrides?: { hasSearched?: boolean; searchType?: SearchType }
) => {
  const searchType = overrides?.searchType ?? "llm";
  const key = getSearchPanelStateKey({
    scope: "events",
    transcriptDir,
    transcriptId,
  });
  act(() => {
    store.getState().setSearchPanelState(key, (prev) => ({
      ...prev,
      searchType,
      searches: {
        ...prev.searches,
        [searchType]: {
          ...prev.searches[searchType],
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

describe("useSearchReferenceLabels", () => {
  it("returns undefined when transcriptDir is missing (no key, no work)", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([{ id: "msg-1", type: "message", cite: "[1]" }])
    );

    const { result } = renderHook(
      () =>
        useSearchReferenceLabels({
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
        useSearchReferenceLabels({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toBeUndefined();
  });

  it("returns labels for message references with a cite", () => {
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
        useSearchReferenceLabels({
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

  it("returns labels for event references with a cite", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([
        { id: "evt-1", type: "event", cite: "[E1]" },
        { id: "evt-2", type: "event", cite: "[E2]" },
      ])
    );

    const { result } = renderHook(
      () =>
        useSearchReferenceLabels({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({
      eventLabels: { "evt-1": "[E1]", "evt-2": "[E2]" },
    });
  });

  it("reads labels from the active grep search", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([{ id: "evt-1", type: "event", cite: "[E1]" }]),
      { searchType: "grep" }
    );

    const { result } = renderHook(
      () =>
        useSearchReferenceLabels({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({
      eventLabels: { "evt-1": "[E1]" },
    });
  });

  it("returns message and event labels together", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([
        { id: "msg-1", type: "message", cite: "[M1]" },
        { id: "evt-1", type: "event", cite: "[E1]" },
      ])
    );

    const { result } = renderHook(
      () =>
        useSearchReferenceLabels({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({
      messageLabels: { "msg-1": "[M1]" },
      eventLabels: { "evt-1": "[E1]" },
    });
  });

  it("filters out refs missing a cite", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([
        { id: "msg-1", type: "message", cite: "[1]" },
        { id: "msg-2", type: "message" },
        { id: "evt-1", type: "event", cite: "[E1]" },
        { id: "evt-2", type: "event" },
      ])
    );

    const { result } = renderHook(
      () =>
        useSearchReferenceLabels({
          scope: "events",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toEqual({
      messageLabels: { "msg-1": "[1]" },
      eventLabels: { "evt-1": "[E1]" },
    });
  });

  it("returns undefined when the result has no labeled references", () => {
    const { wrapper, store } = createTestWrapperWithStore();
    seedSearchResult(
      store,
      buildReferences([
        { id: "msg-1", type: "message" },
        { id: "evt-1", type: "event" },
      ])
    );

    const { result } = renderHook(
      () =>
        useSearchReferenceLabels({
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
        useSearchReferenceLabels({
          scope: "messages",
          transcriptDir,
          transcriptId,
        }),
      { wrapper }
    );

    expect(result.current).toBeUndefined();
  });
});
