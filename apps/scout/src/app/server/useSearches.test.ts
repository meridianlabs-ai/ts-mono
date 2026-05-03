// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import type {
  Result,
  SearchInputListResponse,
  SearchRequest,
} from "../../types/api-types";

import {
  useCachedSearchResult,
  useCreateSearch,
  useSearches,
} from "./useSearches";

const transcriptDir = "/tmp/transcripts";
const transcriptId = "sample-transcript";

const emptyResult = { value: 0, references: [] };

const initialSearches: SearchInputListResponse = {
  items: [
    {
      created_at: "2026-04-10T12:00:00Z",
      ignore_case: true,
      query: "existing grep",
      regex: false,
      search_id: "grep-1",
      type: "grep",
      word_boundary: false,
    },
  ],
};

describe("useSearches", () => {
  it("loads global recent search inputs by type", async () => {
    server.use(
      http.get("/api/v2/searches", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("type")).toBe("grep");
        expect(url.searchParams.get("count")).toBe("20");
        return HttpResponse.json<SearchInputListResponse>(initialSearches);
      })
    );

    const { result } = renderHook(() => useSearches({ searchType: "grep" }), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(initialSearches);
  });
});

describe("useCreateSearch", () => {
  it("posts a search request and reloads recent searches", async () => {
    const request: SearchRequest = {
      ignore_case: false,
      query: "updated grep",
      regex: true,
      type: "grep",
      word_boundary: true,
    };

    const result: Result = emptyResult;
    const updatedSearches: SearchInputListResponse = {
      items: [
        {
          created_at: "2026-04-11T09:00:00Z",
          ignore_case: false,
          query: "updated grep",
          regex: true,
          search_id: "grep-1",
          type: "grep",
          word_boundary: true,
        },
      ],
    };

    let capturedBody: unknown;
    let searchListCalls = 0;

    server.use(
      http.get("/api/v2/searches", () => {
        searchListCalls += 1;
        return HttpResponse.json<SearchInputListResponse>(
          searchListCalls === 1 ? initialSearches : updatedSearches
        );
      }),
      http.post("/api/v2/transcripts/:dir/:id/search", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json<Result>(result);
      })
    );

    const wrapper = createTestWrapper();

    const { result: searchesResult } = renderHook(
      () => useSearches({ searchType: "grep" }),
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
      expect(searchesResult.current.data).toEqual(updatedSearches);
    });
  });
});

describe("useCachedSearchResult", () => {
  it("loads cached transcript search results by search id and scope", async () => {
    const cachedResult: Result = emptyResult;

    server.use(
      http.get(
        "/api/v2/transcripts/:dir/:id/searches/:searchId",
        ({ request, params }) => {
          const url = new URL(request.url);
          expect(params.searchId).toBe("grep-1");
          expect(url.searchParams.get("messages")).toBe("all");
          return HttpResponse.json<Result>(cachedResult);
        }
      )
    );

    const { result } = renderHook(
      () => useCachedSearchResult({ transcriptDir, transcriptId }),
      { wrapper: createTestWrapper() }
    );

    const searchResult = await act(() =>
      result.current.mutateAsync({
        scope: { messages: "all" },
        searchId: "grep-1",
      })
    );

    expect(searchResult).toEqual(cachedResult);
  });

  it("returns null when cached transcript search results are missing", async () => {
    server.use(
      http.get("/api/v2/transcripts/:dir/:id/searches/:searchId", () =>
        HttpResponse.json(
          { detail: "Search result not found" },
          { status: 404 }
        )
      )
    );

    const { result } = renderHook(
      () => useCachedSearchResult({ transcriptDir, transcriptId }),
      { wrapper: createTestWrapper() }
    );

    const searchResult = await act(() =>
      result.current.mutateAsync({
        scope: { events: "all" },
        searchId: "grep-1",
      })
    );

    expect(searchResult).toBeNull();
  });
});
