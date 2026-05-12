// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../../../test/setup-msw";
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
  overrides?: { searchType?: SearchType; searchId?: string | null }
) => {
  const searchType = overrides?.searchType ?? "llm";
  const searchId = overrides?.searchId ?? "search-id-1";
  const key = getSearchPanelStateKey({ scope: "events", transcriptDir });
  server.use(
    http.get("/api/v2/transcripts/:dir/:id/searches/:searchId", () =>
      HttpResponse.json<Result>(result)
    )
  );
  act(() => {
    store.getState().setSearchPanelState(key, (prev) => ({
      ...prev,
      searchType,
      searches: {
        ...prev.searches,
        [searchType]: {
          ...prev.searches[searchType],
          searchId,
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

  it("returns undefined while no active search is selected", () => {
    const { wrapper } = createTestWrapperWithStore();
    // No setSearchPanelState call, so the searchId stays null and
    // the cached query never fires.

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

  it("returns labels for message references with a cite", async () => {
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

    await waitFor(() => {
      expect(result.current).toEqual({
        messageLabels: { "msg-1": "[1]", "msg-2": "[2]" },
      });
    });
  });

  it("returns labels for event references with a cite", async () => {
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

    await waitFor(() => {
      expect(result.current).toEqual({
        eventLabels: { "evt-1": "[E1]", "evt-2": "[E2]" },
      });
    });
  });

  it("reads labels from the active grep search", async () => {
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

    await waitFor(() => {
      expect(result.current).toEqual({
        eventLabels: { "evt-1": "[E1]" },
      });
    });
  });

  it("returns message and event labels together", async () => {
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

    await waitFor(() => {
      expect(result.current).toEqual({
        messageLabels: { "msg-1": "[M1]" },
        eventLabels: { "evt-1": "[E1]" },
      });
    });
  });

  it("filters out refs missing a cite", async () => {
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

    await waitFor(() => {
      expect(result.current).toEqual({
        messageLabels: { "msg-1": "[1]" },
        eventLabels: { "evt-1": "[E1]" },
      });
    });
  });

  it("returns undefined when the result has no labeled references", async () => {
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

    // Allow time for the query to settle; result should remain undefined.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current).toBeUndefined();
  });

  it("isolates state across (scope, transcriptDir) keys", () => {
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
