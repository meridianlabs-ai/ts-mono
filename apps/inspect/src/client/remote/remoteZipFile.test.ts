import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { logFetchInit } from "@tsmono/util";

import { fetchSize } from "./remoteZipFile";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "HEAD"
          ? new Response(null, { headers: { "Accept-Ranges": "bytes" } })
          : new Response(new Uint8Array(1), {
              status: 206,
              headers: { "Content-Range": "bytes 0-0/4096" },
            })
      )
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("fetchSize probes with the hardened log fetch options", async () => {
  const size = await fetchSize("https://example.com/log.eval");

  expect(size).toBe(4096);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls).toHaveLength(2);
  for (const [, init] of calls) {
    expect(init).toMatchObject(logFetchInit);
  }
});
