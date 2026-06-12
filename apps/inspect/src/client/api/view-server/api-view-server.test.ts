import { afterEach, describe, expect, test, vi } from "vitest";

import { viewServerApi } from "./api-view-server";

describe("viewServerApi.eval_log_sample_data_direct", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  test("preserves complete from pending-sample URL responses", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/pending-sample-data-urls?");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () =>
          JSON.stringify({
            segments: [],
            complete: true,
            has_more: false,
          }),
      } as unknown as Response;
    });

    const api = viewServerApi({ apiBaseUrl: "https://viewer.test" });

    const result = await api.eval_log_sample_data_direct!(
      "log.eval",
      "sample-1",
      1
    );

    expect(result).toEqual({
      status: "OK",
      sampleData: {
        events: [],
        attachments: [],
        message_pool: [],
        call_pool: [],
      },
      has_more: false,
      complete: true,
    });
  });
});
