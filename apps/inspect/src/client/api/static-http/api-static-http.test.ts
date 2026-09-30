// @vitest-environment jsdom
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
    expect(
      urls.some((url) => url.startsWith("https://example.com/bucket/a/"))
    ).toBe(true);
    expect(
      urls.some((url) => url.startsWith("https://example.com/bucket/b/"))
    ).toBe(true);
  });
});

describe("staticHttpApi manifest lookup", () => {
  // Keys chosen so that suffix matching alone would pick the wrong entry:
  // `a.eval` is a whole-segment suffix of `sub/a.eval`, and `b.eval` is a
  // plain suffix of `xb.eval`.
  const listing = {
    "a.eval": { task: "root-a", task_id: "root-a" },
    "sub/a.eval": { task: "sub-a", task_id: "sub-a" },
    "b.eval": { task: "b", task_id: "b" },
    "xb.eval": { task: "xb", task_id: "xb" },
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(listing), { status: 200 }))
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("the exact absolute name wins over an earlier suffix match", async () => {
    const api = staticHttpApi("logs");
    const preview = await api.get_log_summary?.(
      "http://localhost:3000/logs/sub/a.eval"
    );
    expect(preview?.task_id).toBe("sub-a");
  });

  test("a shorter key never claims a longer file name", async () => {
    const api = staticHttpApi("logs");
    const previews = await api.get_log_summaries([
      "http://localhost:3000/logs/xb.eval",
      "http://localhost:3000/logs/b.eval",
    ]);
    expect(previews.map((preview) => preview.task_id)).toEqual(["xb", "b"]);
  });

  test("a non-canonical absolute URL falls back to a whole-segment match", async () => {
    const api = staticHttpApi("logs");
    const previews = await api.get_log_summaries([
      "https://mirror.example.com/copy/logs/sub/a.eval",
    ]);
    expect(previews.map((preview) => preview.task_id)).toEqual(["sub-a"]);
  });

  test("an unknown file is skipped by the batch and rejected singly", async () => {
    const api = staticHttpApi("logs");
    await expect(
      api.get_log_summaries(["http://localhost:3000/logs/missing.eval"])
    ).resolves.toEqual([]);
    await expect(
      api.get_log_summary?.("http://localhost:3000/logs/missing.eval")
    ).rejects.toThrow(/Unable to load eval log header/);
  });
});
