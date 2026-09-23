// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { ApiError } from "@tsmono/util";

import { createStatus } from "../../test/objectFactories";
import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import type { ScanJobConfig, Status } from "../../types/api-types";

import { useStartScan } from "./useStartScan";

const mockScanConfig: ScanJobConfig = {
  filter: ["task_id = 'test'"],
};

const mockStatus = createStatus({ location: "/scans/test" });

describe("useStartScan", () => {
  it("sends scan config and returns status on success", async () => {
    let capturedBody: unknown;

    server.use(
      http.post("/api/v2/startscan", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json<Status>(mockStatus);
      })
    );

    const { result } = renderHook(() => useStartScan(), {
      wrapper: createTestWrapper(),
    });

    await act(() => result.current.mutateAsync(mockScanConfig));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(capturedBody).toEqual(mockScanConfig);
    expect(result.current.data).toEqual(mockStatus);
  });

  it("sets error state on server failure", async () => {
    server.use(
      http.post("/api/v2/startscan", () =>
        HttpResponse.text("Bad config", { status: 400 })
      )
    );

    const { result } = renderHook(() => useStartScan(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync(mockScanConfig);
      } catch {
        // expected
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const { error } = result.current;
    expect(error).toBeInstanceOf(ApiError);
    if (error instanceof ApiError) {
      expect(error.status).toBe(400);
    }
  });
});
