import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { fetchRange, logFetchInit } from "./http";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("fetchRange sends the range with the hardened log fetch options", async () => {
  const bytes = await fetchRange("https://example.com/log.eval", 10, 20);

  expect(Array.from(bytes)).toEqual([1, 2, 3]);
  expect(fetch).toHaveBeenCalledWith("https://example.com/log.eval", {
    ...logFetchInit,
    headers: { Range: "bytes=10-20" },
  });
});

test("the hardened options omit the referrer, scope credentials, and refuse redirects", () => {
  expect(logFetchInit).toEqual({
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
});
