import { strToU8, zipSync } from "fflate";
import { delay, http, HttpResponse } from "msw";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError, logFetchInit } from "@tsmono/util";

import { setupMswServer } from "../../test/mswServer";

import {
  fetchPendingSampleDataDirect,
  SEGMENT_CAP_PER_CALL,
} from "./remotePendingSampleData";

const server = setupMswServer();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchPendingSampleDataDirect", () => {
  describe("segment-order preservation", () => {
    // Segment N is a real zip whose one member `mN` holds one event with
    // id=N*10. The delay is inverse to N so higher-id segments resolve
    // first, stressing arrival-order merging.
    const segmentZip = (idx: number): Uint8Array => {
      const eventId = idx * 10;
      return zipSync({
        [`m${idx}`]: strToU8(
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
        ),
      });
    };

    test("merges events in segment order even when fetches resolve out of order", async () => {
      server.use(
        http.get("https://example/:segment", async ({ params }) => {
          const idx = Number(String(params.segment).replace("seg-", ""));
          await delay((3 - idx) * 20);
          // A fresh ArrayBuffer: the body must not alias the zip's buffer.
          return HttpResponse.arrayBuffer(segmentZip(idx).slice().buffer);
        })
      );
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
      // Pass-through spy: the browser-only init options (credentials,
      // referrer, redirect) don't survive node's request interception.
      const fetchSpy = vi.spyOn(globalThis, "fetch");

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
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      for (const [, init] of fetchSpy.mock.calls) {
        expect(init).toMatchObject(logFetchInit);
      }
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

  test("requests up to SEGMENT_CAP_PER_CALL segments", async () => {
    const getUrls = vi.fn().mockResolvedValue({
      segments: [],
      has_more: false,
      complete: true,
    });
    await fetchPendingSampleDataDirect(getUrls, "log", "s1", 1, {});
    expect(getUrls).toHaveBeenCalledWith(
      "log",
      "s1",
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      SEGMENT_CAP_PER_CALL
    );
  });

  test("reports has_more/complete from the response on the empty fast path", async () => {
    const getUrls = vi.fn().mockResolvedValue({
      segments: [],
      has_more: true,
      complete: false,
    });
    const result = await fetchPendingSampleDataDirect(
      getUrls,
      "log",
      "s1",
      1,
      {}
    );
    expect(result?.has_more).toBe(true);
    expect(result?.complete).toBe(false);
  });
});
