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

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });

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

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });
    await api.log_message("log.eval", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    const [url, init] = call;
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

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });
    await api.edit_log!("log.eval", {
      edits: [],
      provenance: {
        author: "a",
        metadata: {},
        timestamp: "2026-01-01T00:00:00Z",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (call === undefined) throw new Error("fetch was not called");
    const [, init] = call;
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        [VIEW_REQUEST_HEADER]: VIEW_REQUEST_HEADER_VALUE,
      },
    });
  });
});

describe("viewServerApi.get_eval_set", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  const okJson = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: () => Promise.resolve("{}"),
    } as unknown as Response);

  test("sends the construction log_dir with no dir param at the listing root", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      okJson()
    );
    globalThis.fetch = fetchMock;

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });
    await api.get_eval_set("");

    // The test only ever calls fetch with a string URL.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(
      "https://viewer.test/eval-set?log_dir=file%3A%2F%2F%2Fx%2Flogs"
    );
  });

  test("sends the subdir as dir alongside the construction log_dir", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      okJson()
    );
    globalThis.fetch = fetchMock;

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });
    await api.get_eval_set("sub/inner");

    // The test only ever calls fetch with a string URL.
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toBe(
      "https://viewer.test/eval-set?log_dir=file%3A%2F%2F%2Fx%2Flogs&dir=sub%2Finner"
    );
  });
});

describe("viewServerApi dir independence", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  const okJson = () =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: () => Promise.resolve("{}"),
      // get_flow reads bytes rather than text.
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as unknown as Response);

  test("two instances over the same transport answer for their own dirs", async () => {
    // The LogViewAPI contract: an instance is bound to its construction dir.
    // Every dir-scoped request carries that dir explicitly, so nothing the
    // server (or host) considers "current" can leak into the answers.
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      okJson()
    );
    globalThis.fetch = fetchMock;

    const a = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///dir/a",
    });
    const b = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///dir/b",
    });

    await a.get_logs(0, 0);
    await b.get_logs(0, 0);
    await a.get_eval_set("");
    await b.get_flow("");

    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([
      "https://viewer.test/log-files?log_dir=file%3A%2F%2F%2Fdir%2Fa",
      "https://viewer.test/log-files?log_dir=file%3A%2F%2F%2Fdir%2Fb",
      "https://viewer.test/eval-set?log_dir=file%3A%2F%2F%2Fdir%2Fa",
      "https://viewer.test/flow?log_dir=file%3A%2F%2F%2Fdir%2Fb",
    ]);
  });
});
