// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import type {
  SavedSearch,
  SavedSearchListResponse,
  SearchRequest,
} from "../../types/api-types";

import { useCreateSearch, useSearches } from "./useSearches";

const transcriptDir = "/tmp/transcripts";
const transcriptId = "sample-transcript";

const initialSearches: SavedSearchListResponse = {
  items: [
    {
      created_at: "2026-04-10T12:00:00Z",
      ignore_case: true,
      query: "existing grep",
      regex: false,
      results: [],
      search_id: "grep-1",
      type: "grep",
      word_boundary: false,
    },
    {
      created_at: "2026-04-10T12:05:00Z",
      model: "gpt-5.4-mini",
      query: "existing llm",
      results: [],
      search_id: "llm-1",
      type: "llm",
    },
  ],
};

describe("useSearches", () => {
  it("loads saved searches for a transcript", async () => {
    server.use(
      http.get("/api/v2/transcripts/:dir/:id/searches", () =>
        HttpResponse.json<SavedSearchListResponse>(initialSearches)
      )
    );

    const { result } = renderHook(
      () => useSearches({ transcriptDir, transcriptId }),
      {
        wrapper: createTestWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(initialSearches);
  });
});

describe("useCreateSearch", () => {
  it("posts a search request and updates the cached recent searches", async () => {
    const request: SearchRequest = {
      ignore_case: false,
      query: "updated grep",
      regex: true,
      type: "grep",
      word_boundary: true,
    };

    const savedSearch: SavedSearch = {
      created_at: "2026-04-11T09:00:00Z",
      ignore_case: false,
      query: "updated grep",
      regex: true,
      results: [],
      search_id: "grep-1",
      type: "grep",
      word_boundary: true,
    };

    let capturedBody: SearchRequest | undefined;

    server.use(
      http.get("/api/v2/transcripts/:dir/:id/searches", () =>
        HttpResponse.json<SavedSearchListResponse>(initialSearches)
      ),
      http.post("/api/v2/transcripts/:dir/:id/search", async ({ request }) => {
        capturedBody = (await request.json()) as SearchRequest;
        return HttpResponse.json<SavedSearch>(savedSearch);
      })
    );

    const wrapper = createTestWrapper();

    const { result: searchesResult } = renderHook(
      () => useSearches({ transcriptDir, transcriptId }),
      { wrapper }
    );
    const { result: mutationResult } = renderHook(
      () => useCreateSearch({ transcriptDir, transcriptId }),
      { wrapper }
    );

    await waitFor(() => {
      expect(searchesResult.current.loading).toBe(false);
    });

    await act(() => mutationResult.current.mutateAsync(request));

    await waitFor(() => {
      expect(mutationResult.current.isSuccess).toBe(true);
    });

    expect(capturedBody).toEqual(request);

    await waitFor(() => {
      expect(searchesResult.current.data?.items).toEqual([
        savedSearch,
        initialSearches.items[1],
      ]);
    });
  });
});
