// @vitest-environment jsdom
import { skipToken } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError, encodeBase64Url } from "@tsmono/util";

import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import type { ValidationCase } from "../../types/api-types";

import {
  useBulkDeleteValidationCases,
  useCopyValidationCases,
  useDeleteValidationCase,
  useUpdateValidationCase,
  useValidationCase,
  useValidationCases,
} from "./useValidations";

const uri = "file:///validations/test.json";
const caseId = "case-1";
const encodedUri = encodeBase64Url(uri);
const encodedCaseId = encodeBase64Url(caseId);

const mockCase: ValidationCase = {
  id: caseId,
  labels: { correct: true },
  target: "expected answer",
  predicate: null,
  split: null,
};

describe("useValidationCase", () => {
  it("returns validation case on success", async () => {
    server.use(
      http.get(`/api/v2/validations/${encodedUri}/${encodedCaseId}`, () =>
        HttpResponse.json<ValidationCase>(mockCase)
      )
    );

    const { result } = renderHook(
      () => useValidationCase({ url: uri, caseId }),
      { wrapper: createTestWrapper() }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockCase);
  });

  it("returns null instead of error on 404", async () => {
    server.use(
      http.get(`/api/v2/validations/${encodedUri}/${encodedCaseId}`, () =>
        HttpResponse.text("Not Found", { status: 404 })
      )
    );

    const { result } = renderHook(
      () => useValidationCase({ url: uri, caseId }),
      { wrapper: createTestWrapper() }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeUndefined();
  });

  it("returns error on non-404 failures", async () => {
    server.use(
      http.get(`/api/v2/validations/${encodedUri}/${encodedCaseId}`, () =>
        HttpResponse.text("Server Error", { status: 500 })
      )
    );

    const { result } = renderHook(
      () => useValidationCase({ url: uri, caseId }),
      { wrapper: createTestWrapper() }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const { error } = result.current;
    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.status).toBe(500);
    }
  });

  it("does not make request when skipToken is passed", async () => {
    let requestMade = false;

    server.use(
      http.get(`/api/v2/validations/${encodedUri}/${encodedCaseId}`, () => {
        requestMade = true;
        return HttpResponse.json<ValidationCase>(mockCase);
      })
    );

    const { result } = renderHook(() => useValidationCase(skipToken), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.loading).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(requestMade).toBe(false);
  });
});

describe("useUpdateValidationCase", () => {
  it("sends update and returns updated case", async () => {
    let capturedBody: unknown;

    const updatedCase = { ...mockCase, labels: { correct: false } };

    server.use(
      http.post(
        `/api/v2/validations/${encodedUri}/${encodedCaseId}`,
        async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json<ValidationCase>(updatedCase);
        }
      )
    );

    const { result } = renderHook(() => useUpdateValidationCase(uri), {
      wrapper: createTestWrapper(),
    });

    const updateData = { labels: { correct: false } };

    await act(() => result.current.mutateAsync({ caseId, data: updateData }));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(capturedBody).toEqual(updateData);
    expect(result.current.data).toEqual(updatedCase);
  });

  it("rolls back optimistic update on error", async () => {
    const wrapper = createTestWrapper();

    // Pre-populate the case cache
    server.use(
      http.get(`/api/v2/validations/${encodedUri}/${encodedCaseId}`, () =>
        HttpResponse.json<ValidationCase>(mockCase)
      )
    );

    const { result: caseResult } = renderHook(
      () => useValidationCase({ url: uri, caseId }),
      { wrapper }
    );

    await waitFor(() => {
      expect(caseResult.current.loading).toBe(false);
    });

    expect(caseResult.current.data).toEqual(mockCase);

    // Now set up the update to fail
    server.use(
      http.post(`/api/v2/validations/${encodedUri}/${encodedCaseId}`, () =>
        HttpResponse.text("Server Error", { status: 500 })
      )
    );

    const { result: mutationResult } = renderHook(
      () => useUpdateValidationCase(uri),
      { wrapper }
    );

    await act(async () => {
      try {
        await mutationResult.current.mutateAsync({
          caseId,
          data: { labels: { correct: false } },
        });
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(mutationResult.current.isError).toBe(true);
    });

    // After rollback, the cache should have the original data
    await waitFor(() => {
      expect(caseResult.current.data).toEqual(mockCase);
    });
  });
});

describe("useBulkDeleteValidationCases", () => {
  const caseIds = ["case-1", "case-2", "case-3"];

  const deleteEndpoint = (id: string) =>
    `/api/v2/validations/${encodedUri}/${encodeBase64Url(id)}`;

  it("deletes all cases successfully", async () => {
    for (const id of caseIds) {
      server.use(
        http.delete(
          deleteEndpoint(id),
          () => new HttpResponse(null, { status: 204 })
        )
      );
    }

    const { result } = renderHook(() => useBulkDeleteValidationCases(uri), {
      wrapper: createTestWrapper(),
    });

    await act(() => result.current.mutateAsync(caseIds));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ succeeded: 3, failed: 0 });
  });

  it("handles partial failures gracefully", async () => {
    // case-1 and case-3 succeed, case-2 fails
    server.use(
      http.delete(
        deleteEndpoint("case-1"),
        () => new HttpResponse(null, { status: 204 })
      ),
      http.delete(deleteEndpoint("case-2"), () =>
        HttpResponse.text("Server Error", { status: 500 })
      ),
      http.delete(
        deleteEndpoint("case-3"),
        () => new HttpResponse(null, { status: 204 })
      )
    );

    const { result } = renderHook(() => useBulkDeleteValidationCases(uri), {
      wrapper: createTestWrapper(),
    });

    await act(() => result.current.mutateAsync(caseIds));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ succeeded: 2, failed: 1 });
  });

  it("throws when all deletions fail", async () => {
    for (const id of caseIds) {
      server.use(
        http.delete(deleteEndpoint(id), () =>
          HttpResponse.text("Server Error", { status: 500 })
        )
      );
    }

    const { result } = renderHook(() => useBulkDeleteValidationCases(uri), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync(caseIds);
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error?.message).toContain("All deletions failed");
  });
});

describe("useDeleteValidationCase", () => {
  it("resets the case query to null without refetching it", async () => {
    const wrapper = createTestWrapper();
    let caseRequests = 0;

    server.use(
      http.get(`/api/v2/validations/${encodedUri}/${encodedCaseId}`, () => {
        caseRequests += 1;
        return HttpResponse.json<ValidationCase>(mockCase);
      }),
      http.get(`/api/v2/validations/${encodedUri}`, () =>
        HttpResponse.json<ValidationCase[]>([])
      ),
      http.delete(
        `/api/v2/validations/${encodedUri}/${encodedCaseId}`,
        () => new HttpResponse(null, { status: 204 })
      )
    );

    const { result: caseResult } = renderHook(
      () => useValidationCase({ url: uri, caseId }),
      { wrapper }
    );
    await waitFor(() => {
      expect(caseResult.current.data).toEqual(mockCase);
    });

    const { result: mutationResult } = renderHook(
      () => useDeleteValidationCase(uri),
      { wrapper }
    );
    await act(() => mutationResult.current.mutateAsync(caseId));

    // The server confirmed the delete, so "no case" is written directly
    // rather than learned from a 404 round-trip (the GET would still
    // return the stale case here).
    await waitFor(() => {
      expect(caseResult.current.data).toBeNull();
    });
    expect(caseRequests).toBe(1);
  });
});

describe("useCopyValidationCases", () => {
  const destUri = "file:///validations/dest.json";
  const encodedDest = encodeBase64Url(destUri);
  const upsertEndpoint = (id: string) =>
    `/api/v2/validations/${encodedDest}/${encodeBase64Url(id)}`;
  const copied = (id: string): ValidationCase => ({
    id,
    labels: null,
    target: `answer-${id}`,
    predicate: null,
    split: null,
  });
  const copyRequest = (ids: string[]) => ({
    destUri,
    cases: ids.map((id) => ({
      caseId: id,
      data: { id, target: `answer-${id}` },
    })),
  });

  it("copies every case and refreshes the destination caches", async () => {
    const wrapper = createTestWrapper();
    const bodies = new Map<string, unknown>();
    let destListRequests = 0;
    let saved: ValidationCase | null = null;

    server.use(
      http.get(`/api/v2/validations/${encodedDest}`, () => {
        destListRequests += 1;
        return HttpResponse.json<ValidationCase[]>(saved ? [saved] : []);
      }),
      http.get(upsertEndpoint("case-1"), () =>
        HttpResponse.json<ValidationCase | { detail: string }>(
          saved ?? { detail: "Not Found" },
          { status: saved ? 200 : 404 }
        )
      ),
      http.post(upsertEndpoint("case-1"), async ({ request }) => {
        bodies.set("case-1", await request.json());
        saved = copied("case-1");
        return HttpResponse.json<ValidationCase>(saved);
      }),
      http.post(upsertEndpoint("case-2"), async ({ request }) => {
        bodies.set("case-2", await request.json());
        return HttpResponse.json<ValidationCase>(copied("case-2"));
      })
    );

    // Observe the destination list and one destination case (cached as
    // missing) so their invalidation is visible as refetches.
    const { result: listResult } = renderHook(
      () => useValidationCases(destUri),
      { wrapper }
    );
    const { result: caseResult } = renderHook(
      () => useValidationCase({ url: destUri, caseId: "case-1" }),
      { wrapper }
    );
    await waitFor(() => {
      expect(listResult.current.data).toEqual([]);
      expect(caseResult.current.data).toBeNull();
    });

    const { result } = renderHook(() => useCopyValidationCases(), {
      wrapper,
    });
    await act(() =>
      result.current.mutateAsync(copyRequest(["case-1", "case-2"]))
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ succeeded: 2, failed: 0 });
    });
    expect(bodies.get("case-1")).toEqual({
      id: "case-1",
      target: "answer-case-1",
    });
    expect(bodies.get("case-2")).toEqual({
      id: "case-2",
      target: "answer-case-2",
    });

    // The list refetch is awaited by the mutation; the case refetch lands
    // in the background.
    expect(destListRequests).toBe(2);
    expect(listResult.current.data).toEqual([copied("case-1")]);
    await waitFor(() => {
      expect(caseResult.current.data).toEqual(copied("case-1"));
    });
  });

  it("reports partial failures and still refreshes the destination", async () => {
    const wrapper = createTestWrapper();
    let destListRequests = 0;

    server.use(
      http.get(`/api/v2/validations/${encodedDest}`, () => {
        destListRequests += 1;
        return HttpResponse.json<ValidationCase[]>([]);
      }),
      http.post(upsertEndpoint("case-1"), () =>
        HttpResponse.json<ValidationCase>(copied("case-1"))
      ),
      http.post(upsertEndpoint("case-2"), () =>
        HttpResponse.text("Server Error", { status: 500 })
      )
    );

    const { result: listResult } = renderHook(
      () => useValidationCases(destUri),
      { wrapper }
    );
    await waitFor(() => {
      expect(listResult.current.loading).toBe(false);
    });

    const { result } = renderHook(() => useCopyValidationCases(), {
      wrapper,
    });
    await act(() =>
      result.current.mutateAsync(copyRequest(["case-1", "case-2"]))
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ succeeded: 1, failed: 1 });
    });
    expect(destListRequests).toBe(2);
  });

  it("throws when every copy fails", async () => {
    server.use(
      http.post(`/api/v2/validations/${encodedDest}/:id`, () =>
        HttpResponse.text("Server Error", { status: 500 })
      )
    );

    const { result } = renderHook(() => useCopyValidationCases(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync(copyRequest(["case-1", "case-2"]));
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toContain(
      "All 2 copy operations failed"
    );
  });
});
