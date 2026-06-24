import { afterEach, describe, expect, test, vi } from "vitest";

import { viewServerApi } from "./api-view-server";
import { VIEW_REQUEST_HEADER, VIEW_REQUEST_HEADER_VALUE } from "./request";

describe("viewServerApi.eval_log_sample_data_direct", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  test("preserves complete from pending-sample URL responses", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      // The test only ever calls fetch with a string URL.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      const url = String(input);
      expect(url).toContain("/pending-sample-data-urls?");
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () =>
          Promise.resolve(
            JSON.stringify({
              segments: [],
              complete: true,
              has_more: false,
            })
          ),
      } as unknown as Response);
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

describe("viewServerApi mutation requests", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  test("posts client messages with the viewer request header", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 204,
        statusText: "No Content",
        text: () => Promise.resolve(""),
      } as unknown as Response)
    );
    globalThis.fetch = fetchMock;

    const api = viewServerApi({ apiBaseUrl: "https://viewer.test" });
    await api.log_message("log.eval", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/log-message?");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        [VIEW_REQUEST_HEADER]: VIEW_REQUEST_HEADER_VALUE,
      },
    });
  });

  test("adds the viewer request header to log edits", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        text: () => Promise.resolve("{}"),
      } as unknown as Response)
    );
    globalThis.fetch = fetchMock;

    const api = viewServerApi({ apiBaseUrl: "https://viewer.test" });
    await api.edit_log!("log.eval", {
      edits: [],
      provenance: {
        author: "a",
        metadata: {},
        timestamp: "2026-01-01T00:00:00Z",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        [VIEW_REQUEST_HEADER]: VIEW_REQUEST_HEADER_VALUE,
      },
    });
  });
});
