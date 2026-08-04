import { describe, expect, test } from "vitest";

import type { VSCodeApi } from "@tsmono/util";

import { apiVscodeHttp } from "./api-vscode-http";

const LOG_DIR = "file:///logs";

// None of these tests touch the network; `proxyFetch` is required so callers
// can't fall back to a per-instance JSON-RPC client (listener leak).
const stubFetch: typeof fetch = () =>
  Promise.reject(new Error("network unused in this test"));

function fakeVscode() {
  const posted: unknown[] = [];
  const api = {
    postMessage: (msg: unknown) => posted.push(msg),
    getState: () => undefined,
    setState: (s: unknown) => s,
  } as unknown as VSCodeApi;
  return { api, posted };
}

describe("apiVscodeHttp", () => {
  test("open_log_file posts a one-way displayLogFile message", async () => {
    const { api, posted } = fakeVscode();
    await apiVscodeHttp(api, LOG_DIR, stubFetch).open_log_file("/logs/x.eval", "/logs");
    expect(posted).toContainEqual({
      type: "displayLogFile",
      url: "/logs/x.eval",
      log_dir: "/logs",
    });
  });

  test("download_file is unsupported in VS Code", () => {
    const { api } = fakeVscode();
    expect(() =>
      apiVscodeHttp(api, LOG_DIR, stubFetch).download_file("x", "data")
    ).toThrow(/not supported/i);
  });

  test("client_events is disabled (returns empty array)", async () => {
    const { api } = fakeVscode();
    await expect(apiVscodeHttp(api, LOG_DIR, stubFetch).client_events()).resolves.toEqual(
      []
    );
  });

  test("download_log is not exposed", () => {
    const { api } = fakeVscode();
    expect(apiVscodeHttp(api, LOG_DIR, stubFetch).download_log).toBeUndefined();
  });

  test("eval_log_sample_data_direct is not exposed", () => {
    const { api } = fakeVscode();
    expect(
      apiVscodeHttp(api, LOG_DIR, stubFetch).eval_log_sample_data_direct
    ).toBeUndefined();
  });
});
