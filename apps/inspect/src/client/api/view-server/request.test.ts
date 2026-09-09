import { describe, expect, test, vi } from "vitest";

import { serverRequestApi } from "./request";

describe("serverRequestApi customFetch", () => {
  test("routes requests through the provided customFetch", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const customFetch = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        // The test only ever calls fetch with a string URL.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        calls.push({ url: String(input), method: init?.method });
        return Promise.resolve(
          new Response("[]", { status: 200, statusText: "OK" })
        );
      }
    );

    const api = serverRequestApi("/api", undefined, customFetch);
    await api.fetchString("GET", "/logs");

    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(calls[0]?.url).toBe("/api/logs");
    expect(calls[0]?.method).toBe("GET");
  });

  test("falls back to global fetch when no customFetch given", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("[]", { status: 200, statusText: "OK" }))
    );
    try {
      const api = serverRequestApi("/api");
      await api.fetchString("GET", "/logs");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
