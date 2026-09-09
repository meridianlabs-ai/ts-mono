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
      return Promise.resolve(
        new Response(
          JSON.stringify({
            segments: [],
            complete: true,
            has_more: false,
          }),
          { status: 200, statusText: "OK" }
        )
      );
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
      Promise.resolve(
        new Response(null, { status: 204, statusText: "No Content" })
      )
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
      Promise.resolve(new Response("{}", { status: 200, statusText: "OK" }))
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
    Promise.resolve(new Response("{}", { status: 200, statusText: "OK" }));

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

  // get_flow reads this as bytes rather than text; "{}" decodes fine either way.
  const okJson = () =>
    Promise.resolve(new Response("{}", { status: 200, statusText: "OK" }));

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

// Wiring tests for boundary normalization (#555): these fail if the
// normalize calls are removed from the transport, not just if the
// normalizers themselves regress. The stubbed server responses model an
// OLDER inspect_ai server (version skew is routine in the VS Code
// extension): v1-shaped results and events missing type-required fields.
describe("viewServerApi boundary normalization", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  const oldServerEval = {
    task: "demo",
    task_id: "t1",
    run_id: "r1",
    created: "2024-06-26T08:50:44+00:00",
    model: "mockllm/model",
    dataset: {},
    config: {},
  };

  const v1Results = {
    scorer: { name: "match", params: {} },
    metrics: { mean: { name: "mean", value: 0.5, params: {} } },
  };

  test("get_log_contents normalizes an old server's /logs response", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      expect(String(input)).toContain("/logs/");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: 1,
            status: "success",
            eval: oldServerEval,
            results: v1Results,
            samples: [
              {
                id: 1,
                epoch: 1,
                input: "q",
                score: { value: 1 },
                events: [{ event: "model", timestamp: "t", model: "m" }],
              },
            ],
          }),
          { status: 200, statusText: "OK" }
        )
      );
    });

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });
    const contents = await api.get_log_contents("old.json", 100);

    // v1 reshape applied on the transport, not just in static-http
    expect(contents.parsed.results?.scores[0]?.scorer).toBe("match");
    expect(contents.parsed.samples?.[0]?.scores).toEqual({
      match: { value: 1 },
    });
    // read-time defaults filled on nested events
    const event = contents.parsed.samples?.[0]?.events[0];
    expect(event?.working_start).toBe(0);
    expect(event?.event === "model" && event.config).toEqual({});
    expect(contents.parsed.eval.task_args_passed).toEqual({});
  });

  test("get_log_summaries normalizes old /log-headers responses into previews", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      expect(String(input)).toContain("/log-headers?");
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              version: 1,
              status: "success",
              eval: oldServerEval,
              results: v1Results,
            },
          ]),
          { status: 200, statusText: "OK" }
        )
      );
    });

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });
    const previews = await api.get_log_summaries(["old.json"]);

    expect(previews).toHaveLength(1);
    expect(previews[0]?.task).toBe("demo");
    // primary_metric only exists because the v1 scorer→scores reshape ran
    expect(previews[0]?.primary_metric?.value).toBe(0.5);
  });

  test("eval_pending_samples normalizes old-shaped pending summaries", async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      expect(String(input)).toContain("/pending-samples?");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            refresh: 5,
            samples: [
              // an old server's row: only the original five fields
              {
                id: "s1",
                epoch: 1,
                input: "q",
                target: "a",
                scores: null,
              },
              "garbage-entry",
            ],
          }),
          { status: 200, statusText: "OK" }
        )
      );
    });

    const api = viewServerApi({
      apiBaseUrl: "https://viewer.test",
      logDir: "file:///x/logs",
    });
    const result = await api.eval_pending_samples!("running.eval");

    expect(result.status).toBe("OK");
    const samples = result.pendingSamples?.samples;
    expect(samples).toHaveLength(1);
    expect(samples?.[0]).toMatchObject({
      id: "s1",
      completed: true,
      metadata: {},
      model_usage: {},
      role_usage: {},
    });
  });
});
