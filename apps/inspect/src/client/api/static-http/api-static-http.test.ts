import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import staticHttpApi, { staticLogRoot } from "./api-static-http";

// jsdom serves the "page" at http://localhost:3000/ — the base the canonical
// namespace embeds for relative log dirs.
describe("staticHttpApi identities", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              "task_abc123.eval": { task: "test-task", task_id: "task-1" },
            }),
            { status: 200 }
          )
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("a relative log_dir yields an origin-unique root (bootstrap)", () => {
    const root = staticLogRoot("logs");
    expect(root.log_dir).toBe("http://localhost:3000/logs");
  });

  test("an absolute log_dir is already canonical (bootstrap)", () => {
    const root = staticLogRoot("https://example.com/bucket/logs");
    expect(root.log_dir).toBe("https://example.com/bucket/logs");
  });

  test("get_logs lists manifest entries under the construction dir", async () => {
    const api = staticHttpApi("logs");
    const listing = await api.get_logs(0, 0);

    expect(listing.response_type).toBe("full");
    expect(listing.files.map((log) => log.name)).toEqual([
      "http://localhost:3000/logs/task_abc123.eval",
    ]);
  });

  test("two instances with different dirs answer independently", async () => {
    // The LogViewAPI contract: an instance's answers are fully determined by
    // its construction dir — same transport (the page's fetch), different
    // dirs, independent listings.
    const a = staticHttpApi("https://example.com/bucket/a");
    const b = staticHttpApi("https://example.com/bucket/b");

    const [listingA, listingB] = await Promise.all([
      a.get_logs(0, 0),
      b.get_logs(0, 0),
    ]);

    expect(listingA.files.map((log) => log.name)).toEqual([
      "https://example.com/bucket/a/task_abc123.eval",
    ]);
    expect(listingB.files.map((log) => log.name)).toEqual([
      "https://example.com/bucket/b/task_abc123.eval",
    ]);

    // Each manifest fetch went to its own dir.
    const fetchMock = vi.mocked(globalThis.fetch);
    // The test only ever calls fetch with a string URL.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.startsWith("https://example.com/bucket/a/")))
      .toBe(true);
    expect(urls.some((url) => url.startsWith("https://example.com/bucket/b/")))
      .toBe(true);
  });
});
