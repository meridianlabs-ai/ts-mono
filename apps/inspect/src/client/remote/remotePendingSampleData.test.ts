import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../api/view-server/request";

import { fetchPendingSampleDataDirect } from "./remotePendingSampleData";

vi.mock("./remoteZipFile", () => ({
  openZipFileFromBuffer: vi.fn((bytes: Uint8Array) =>
    Promise.resolve({
      readFile: (_member: string) => Promise.resolve(bytes),
    })
  ),
}));

vi.mock("../../utils/json-worker", () => ({
  asyncJsonParseBytes: vi.fn((bytes: Uint8Array) =>
    Promise.resolve(JSON.parse(new TextDecoder().decode(bytes)))
  ),
}));

describe("fetchPendingSampleDataDirect", () => {
  describe("segment-order preservation", () => {
    const realFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        // The test only ever calls fetch with a string URL.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        const url = String(input);
        // Segment N encodes one event with id=N*10. Delay is inverse to N so
        // higher-id segments resolve first, stressing arrival-order merging.
        const match = url.match(/seg-(\d+)/);
        const idx = match ? Number(match[1]) : 0;
        const eventId = idx * 10;
        const delay = (3 - idx) * 20;
        await new Promise((r) => setTimeout(r, delay));
        const body = new TextEncoder().encode(
          JSON.stringify({
            events: [
              {
                id: eventId,
                event_id: `e${eventId}`,
                sample_id: "s1",
                epoch: 0,
                event: {},
              },
            ],
            attachments: [],
            message_pool: [],
            call_pool: [],
          })
        );
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: () => Promise.resolve(body.buffer),
        } as unknown as Response;
      });
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    test("merges events in segment order even when fetches resolve out of order", async () => {
      const getUrls = vi.fn().mockResolvedValue({
        segments: [
          { id: 0, member_name: "m0", direct_url: "https://example/seg-0" },
          { id: 1, member_name: "m1", direct_url: "https://example/seg-1" },
          { id: 2, member_name: "m2", direct_url: "https://example/seg-2" },
          { id: 3, member_name: "m3", direct_url: "https://example/seg-3" },
        ],
        complete: true,
        has_more: true,
      });

      const result = await fetchPendingSampleDataDirect(
        getUrls,
        "log.eval",
        "sample1",
        0,
        {}
      );

      expect(result).toBeDefined();
      expect(result!.complete).toBe(true);
      expect(result!.has_more).toBe(true);
      expect(result!.sampleData.events.map((e) => e.id)).toEqual([
        0, 10, 20, 30,
      ]);
    });
  });

  test("returns undefined on ApiError(404) from getUrls (server doesn't support direct path)", async () => {
    const getUrls = vi.fn().mockRejectedValue(new ApiError(404, "not found"));

    const result = await fetchPendingSampleDataDirect(
      getUrls,
      "log.eval",
      "sample1",
      0,
      {}
    );

    expect(result).toBeUndefined();
  });

  test("rethrows non-404 errors from getUrls", async () => {
    const getUrls = vi.fn().mockRejectedValue(new ApiError(500, "boom"));

    await expect(
      fetchPendingSampleDataDirect(getUrls, "log.eval", "sample1", 0, {})
    ).rejects.toThrow(ApiError);
  });

  test("returns undefined when any segment lacks direct_url (non-S3 buffer)", async () => {
    const getUrls = vi.fn().mockResolvedValue({
      segments: [
        { id: 0, member_name: "m0", direct_url: "https://example/seg-0" },
        { id: 1, member_name: "m1", direct_url: null },
      ],
      complete: false,
      has_more: false,
    });

    const result = await fetchPendingSampleDataDirect(
      getUrls,
      "log.eval",
      "sample1",
      0,
      {}
    );

    expect(result).toBeUndefined();
  });

  test("returns metadata from the URL manifest on the empty-segments short-circuit", async () => {
    const getUrls = vi.fn().mockResolvedValue({
      segments: [],
      complete: true,
      has_more: true,
    });

    const result = await fetchPendingSampleDataDirect(
      getUrls,
      "log.eval",
      "sample1",
      0,
      {}
    );

    expect(result).toBeDefined();
    expect(result!.complete).toBe(true);
    expect(result!.has_more).toBe(true);
    expect(result!.sampleData).toEqual({
      events: [],
      attachments: [],
      message_pool: [],
      call_pool: [],
    });
  });

  test("defaults missing complete and has_more fields to false on the empty-segments short-circuit", async () => {
    const getUrls = vi.fn().mockResolvedValue({
      segments: [],
    });

    const result = await fetchPendingSampleDataDirect(
      getUrls,
      "log.eval",
      "sample1",
      0,
      {}
    );

    expect(result).toBeDefined();
    expect(result!.complete).toBe(false);
    expect(result!.has_more).toBe(false);
  });
});
