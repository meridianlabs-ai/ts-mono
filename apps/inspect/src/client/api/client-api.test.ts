import { describe, expect, test, vi } from "vitest";

import { openRemoteLogFile } from "../remote/remoteLogFile";

import { clientApi } from "./client-api";
import {
  EditLogResult,
  LogViewAPI,
  SampleData,
  SampleDataResponse,
} from "./types";

// Mock the remote zip reader so .eval cache tests don't try to talk to the
// real backend. The factory must be hoisted before clientApi is exercised.
vi.mock("../remote/remoteLogFile", () => ({
  openRemoteLogFile: vi.fn(),
  SampleNotFoundError: class SampleNotFoundError extends Error {},
}));

const emptySampleData: SampleData = {
  events: [],
  attachments: [],
  message_pool: [],
  call_pool: [],
};

const okResponse = (has_more = false): SampleDataResponse => ({
  status: "OK",
  sampleData: emptySampleData,
  has_more,
});

const baseApi = (): LogViewAPI => ({
  client_events: vi.fn().mockResolvedValue([]),
  get_eval_set: vi.fn().mockResolvedValue(undefined),
  get_flow: vi.fn().mockResolvedValue(undefined),
  get_log_root: vi.fn().mockResolvedValue(undefined),
  get_log_contents: vi.fn(),
  get_log_info: vi.fn(),
  get_log_bytes: vi.fn(),
  get_log_summaries: vi.fn().mockResolvedValue([]),
  log_message: vi.fn(),
  download_file: vi.fn(),
  open_log_file: vi.fn(),
  get_app_config: vi
    .fn()
    .mockResolvedValue({ inspect_version: "test", scout_version: null }),
});

describe("clientApi.get_log_sample_data path selection", () => {
  test("pins to direct on the first call when the probe succeeds", async () => {
    const direct = vi.fn().mockResolvedValue(okResponse(true));
    const proxy = vi.fn().mockResolvedValue(okResponse());
    const api: LogViewAPI = {
      ...baseApi(),
      eval_log_sample_data: proxy,
      eval_log_sample_data_direct: direct,
    };
    const client = clientApi(api);

    const first = await client.get_log_sample_data!("log.eval", "s1", 0);
    const second = await client.get_log_sample_data!("log.eval", "s1", 0);

    expect(first?.has_more).toBe(true);
    expect(second?.has_more).toBe(true);
    expect(direct).toHaveBeenCalledTimes(2);
    expect(proxy).not.toHaveBeenCalled();
  });

  test("pins to proxy when the probe returns undefined and never probes again", async () => {
    const direct = vi.fn().mockResolvedValue(undefined);
    const proxy = vi.fn().mockResolvedValue(okResponse());
    const api: LogViewAPI = {
      ...baseApi(),
      eval_log_sample_data: proxy,
      eval_log_sample_data_direct: direct,
    };
    const client = clientApi(api);

    await client.get_log_sample_data!("log.eval", "s1", 0);
    await client.get_log_sample_data!("log.eval", "s1", 0);

    expect(direct).toHaveBeenCalledTimes(1);
    expect(proxy).toHaveBeenCalledTimes(2);
  });

  test("uses proxy when the API doesn't expose the direct method", async () => {
    const proxy = vi.fn().mockResolvedValue(okResponse());
    const api: LogViewAPI = {
      ...baseApi(),
      eval_log_sample_data: proxy,
    };
    const client = clientApi(api);

    await client.get_log_sample_data!("log.eval", "s1", 0);

    expect(proxy).toHaveBeenCalledTimes(1);
  });

  test("real errors from the direct probe bubble up and don't pin a path", async () => {
    const direct = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(okResponse());
    const proxy = vi.fn().mockResolvedValue(okResponse());
    const api: LogViewAPI = {
      ...baseApi(),
      eval_log_sample_data: proxy,
      eval_log_sample_data_direct: direct,
    };
    const client = clientApi(api);

    await expect(
      client.get_log_sample_data!("log.eval", "s1", 0)
    ).rejects.toThrow("network");

    // Next call retries the probe (no path was pinned).
    await client.get_log_sample_data!("log.eval", "s1", 0);
    expect(direct).toHaveBeenCalledTimes(2);
    expect(proxy).not.toHaveBeenCalled();
  });

  test("pins per-log_file independently", async () => {
    const direct = vi
      .fn()
      .mockResolvedValueOnce(okResponse()) // log A: probe ok
      .mockResolvedValueOnce(undefined) // log B: not supported
      .mockResolvedValueOnce(okResponse()); // log A: follow-up
    const proxy = vi.fn().mockResolvedValue(okResponse());
    const api: LogViewAPI = {
      ...baseApi(),
      eval_log_sample_data: proxy,
      eval_log_sample_data_direct: direct,
    };
    const client = clientApi(api);

    await client.get_log_sample_data!("a.eval", "s1", 0);
    await client.get_log_sample_data!("b.eval", "s1", 0);
    await client.get_log_sample_data!("a.eval", "s1", 0);
    await client.get_log_sample_data!("b.eval", "s1", 0);

    expect(direct).toHaveBeenCalledTimes(3); // a-probe, b-probe, a-followup
    expect(proxy).toHaveBeenCalledTimes(2); // b-first (after probe), b-followup
  });
});

describe("clientApi.edit_log cache invalidation", () => {
  // The user-facing concern: after a successful edit, the next read on the
  // SAME log must return fresh data. For .eval files (the common case)
  // this requires invalidating `loadedEvalFile`, the parsed-zip cache
  // sitting between `get_log_details` and the underlying log fetcher.
  // Without that, refreshLog() returns a stale RemoteLogFile and the UI
  // shows the pre-edit tags. The JSON path uses no cache in
  // get_log_details, so we don't exercise it here.

  const sampleSummary = { tags: [] as string[], sampleSummaries: [] };
  const okEdit: EditLogResult = {
    log: {} as unknown as EditLogResult["log"],
  };
  const okUpdate = {
    edits: [],
    provenance: {
      author: "a",
      metadata: {} as Record<string, never>,
      timestamp: "2026-01-01T00:00:00Z",
    },
  };

  test("subsequent reads on the same .eval file re-open after an edit", async () => {
    const readLogSummary = vi.fn().mockResolvedValue(sampleSummary);
    const remoteLogFile = { readLogSummary } as unknown as Awaited<
      ReturnType<typeof openRemoteLogFile>
    >;
    const openMock = vi.mocked(openRemoteLogFile);
    openMock.mockReset();
    openMock.mockResolvedValue(remoteLogFile);

    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValue(okEdit);
    const client = clientApi({ ...baseApi(), edit_log });

    await client.get_log_details("log.eval", true);
    await client.get_log_details("log.eval", true);
    // Sanity: second read was a cache hit.
    expect(openMock).toHaveBeenCalledTimes(1);

    await client.edit_log!("log.eval", okUpdate);

    await client.get_log_details("log.eval", true);
    // Edit invalidated the cache → next read re-opened the zip and would
    // pick up the new header bytes from disk.
    expect(openMock).toHaveBeenCalledTimes(2);
  });

  test("an edit on a different log preserves the cached one", async () => {
    const readLogSummary = vi.fn().mockResolvedValue(sampleSummary);
    const remoteLogFile = { readLogSummary } as unknown as Awaited<
      ReturnType<typeof openRemoteLogFile>
    >;
    const openMock = vi.mocked(openRemoteLogFile);
    openMock.mockReset();
    openMock.mockResolvedValue(remoteLogFile);

    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValue(okEdit);
    const client = clientApi({ ...baseApi(), edit_log });

    await client.get_log_details("a.eval", true);
    // Edit a different file — `a.eval`'s cache should survive.
    await client.edit_log!("b.eval", okUpdate);
    await client.get_log_details("a.eval", true);

    expect(openMock).toHaveBeenCalledTimes(1);
  });

  test("a failed edit does not invalidate the cache", async () => {
    // Cache is dropped only after the underlying call resolves; a
    // rejection propagates without disturbing the cached reader. This
    // matters so a 412 conflict doesn't trigger an unnecessary refetch.
    const readLogSummary = vi.fn().mockResolvedValue(sampleSummary);
    const remoteLogFile = { readLogSummary } as unknown as Awaited<
      ReturnType<typeof openRemoteLogFile>
    >;
    const openMock = vi.mocked(openRemoteLogFile);
    openMock.mockReset();
    openMock.mockResolvedValue(remoteLogFile);

    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockRejectedValue(new Error("412 Precondition Failed"));
    const client = clientApi({ ...baseApi(), edit_log });

    await client.get_log_details("log.eval", true);
    await expect(client.edit_log!("log.eval", okUpdate)).rejects.toThrow("412");
    await client.get_log_details("log.eval", true);

    expect(openMock).toHaveBeenCalledTimes(1);
  });
});

describe("clientApi.edit_log etag plumbing", () => {
  // Concern: the API layer accepts `if_match_etag` and returns
  // `result.etag`, but the dialogs call `edit_log(file, update)` with no
  // third argument. If the middleware also threw `result.etag` away,
  // the server's If-Match / 412 protection would be unreachable from
  // the shipped UI — only tests and external callers would ever
  // exercise it.
  //
  // The middleware therefore persists `result.etag` per-log and
  // re-supplies it as `if_match_etag` on the next call when the caller
  // doesn't pass one explicitly. These tests pin that behavior.

  const okUpdate = {
    edits: [],
    provenance: {
      author: "a",
      metadata: {} as Record<string, never>,
      timestamp: "2026-01-01T00:00:00Z",
    },
  };
  const okLog = {} as unknown as EditLogResult["log"];

  test("carries the etag from a successful edit forward to the next edit on the same log", async () => {
    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValueOnce({ log: okLog, etag: "etag-after-first" })
      .mockResolvedValueOnce({ log: okLog, etag: "etag-after-second" });
    const client = clientApi({ ...baseApi(), edit_log });

    // First edit: nothing cached yet, so no If-Match is sent.
    await client.edit_log!("log.eval", okUpdate);
    expect(edit_log).toHaveBeenNthCalledWith(
      1,
      "log.eval",
      okUpdate,
      undefined
    );

    // Second edit: caller again passes nothing, but the middleware
    // should re-supply the etag returned by the previous call so the
    // server's concurrent-edit protection can actually fire.
    await client.edit_log!("log.eval", okUpdate);
    expect(edit_log).toHaveBeenNthCalledWith(
      2,
      "log.eval",
      okUpdate,
      "etag-after-first"
    );
  });

  test("an explicit if_match_etag from the caller wins over the cached one", async () => {
    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValue({ log: okLog, etag: "from-server" });
    const client = clientApi({ ...baseApi(), edit_log });

    await client.edit_log!("log.eval", okUpdate);
    await client.edit_log!("log.eval", okUpdate, "caller-supplied");
    expect(edit_log).toHaveBeenNthCalledWith(
      2,
      "log.eval",
      okUpdate,
      "caller-supplied"
    );
  });

  test("etag cache is keyed by log file — an edit on one log doesn't leak to another", async () => {
    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValue({ log: okLog, etag: "etag-foo" });
    const client = clientApi({ ...baseApi(), edit_log });

    await client.edit_log!("foo.eval", okUpdate);
    // Different log → no cached etag for `bar.eval` yet.
    await client.edit_log!("bar.eval", okUpdate);
    expect(edit_log).toHaveBeenNthCalledWith(
      2,
      "bar.eval",
      okUpdate,
      undefined
    );
  });

  test("a failed edit doesn't poison the cache — the next attempt still uses the last good etag", async () => {
    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValueOnce({ log: okLog, etag: "good" })
      .mockRejectedValueOnce(new Error("400 invalid"))
      .mockResolvedValueOnce({ log: okLog, etag: "good2" });
    const client = clientApi({ ...baseApi(), edit_log });

    await client.edit_log!("log.eval", okUpdate);
    await expect(client.edit_log!("log.eval", okUpdate)).rejects.toThrow("400");
    await client.edit_log!("log.eval", okUpdate);
    // After the rejection the cache is unchanged, so the third call
    // still sends the etag from the first successful edit.
    expect(edit_log).toHaveBeenNthCalledWith(3, "log.eval", okUpdate, "good");
  });

  test("a response without an etag leaves the cache unchanged", async () => {
    // Local-filesystem edits don't return an ETag (S3-only). A second
    // edit on the same log shouldn't suddenly start sending `If-Match:
    // undefined-stringified` or similar — the third argument stays
    // undefined.
    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValue({ log: okLog });
    const client = clientApi({ ...baseApi(), edit_log });

    await client.edit_log!("log.eval", okUpdate);
    await client.edit_log!("log.eval", okUpdate);
    expect(edit_log).toHaveBeenNthCalledWith(
      2,
      "log.eval",
      okUpdate,
      undefined
    );
  });

  test("the first edit after opening an .eval log uses the etag captured at open time", async () => {
    // Verifies the second half of the fix: `get_log_details` seeds the
    // per-log etag cache from `LogDetails.etag` (lifted off the
    // `get_log_info` S3 head_object response), so the *first* save in
    // a session also carries `If-Match`. Without this seeding, only
    // chained edits would be protected.
    const readLogSummary = vi.fn().mockResolvedValue({
      tags: [] as string[],
      sampleSummaries: [],
      etag: "initial-from-s3",
    });
    const remoteLogFile = { readLogSummary } as unknown as Awaited<
      ReturnType<typeof openRemoteLogFile>
    >;
    const openMock = vi.mocked(openRemoteLogFile);
    openMock.mockReset();
    openMock.mockResolvedValue(remoteLogFile);

    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValue({ log: okLog, etag: "after-edit" });
    const client = clientApi({ ...baseApi(), edit_log });

    await client.get_log_details("log.eval", true);
    await client.edit_log!("log.eval", okUpdate);
    expect(edit_log).toHaveBeenCalledWith(
      "log.eval",
      okUpdate,
      "initial-from-s3"
    );
  });

  test("a fresh get_log_details refreshes the cached etag", async () => {
    // After someone else edits the file and the client refreshes, the
    // cached etag must update to the new value — otherwise the next
    // edit would race using the stale etag and get a (correct but
    // confusing) 412 even though the user's local view is in sync.
    const readLogSummary = vi
      .fn()
      .mockResolvedValueOnce({
        tags: [],
        sampleSummaries: [],
        etag: "v1",
      })
      .mockResolvedValueOnce({
        tags: [],
        sampleSummaries: [],
        etag: "v2",
      });
    const remoteLogFile = { readLogSummary } as unknown as Awaited<
      ReturnType<typeof openRemoteLogFile>
    >;
    const openMock = vi.mocked(openRemoteLogFile);
    openMock.mockReset();
    openMock.mockResolvedValue(remoteLogFile);

    const edit_log = vi
      .fn<NonNullable<LogViewAPI["edit_log"]>>()
      .mockResolvedValue({ log: okLog });
    const client = clientApi({ ...baseApi(), edit_log });

    // First open: caches v1.
    await client.get_log_details("log.eval", true);
    // Refresh: caches v2.
    await client.get_log_details("log.eval", false);
    await client.edit_log!("log.eval", okUpdate);
    expect(edit_log).toHaveBeenCalledWith("log.eval", okUpdate, "v2");
  });
});
