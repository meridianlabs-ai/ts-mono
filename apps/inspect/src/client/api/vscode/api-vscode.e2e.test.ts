import { describe, expect, test } from "vitest";

import type { VSCodeApi } from "@tsmono/util";

import { apiVscode, createVscodeProxyFetch } from "./api-vscode";

type ProxyRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
};
type ProxyResponse = {
  status: number;
  headers: Record<string, string>;
  body: string | null;
  bodyEncoding: "utf8" | "base64";
};

// Simulates the extension host end-to-end: receives the JSON-RPC `http_request`
// messages the viewer posts, runs `handler` to produce an HttpProxyResponse, and
// delivers it back as a JSON-RPC `result` via a window 'message' event — the same
// round trip the real webview <-> extension transport performs. This exercises
// the full viewer-side wire (postMessage out, id correlation, response decode,
// view-server parse) that the isolated unit tests stub out.
function connectFakeExtension(handler: (req: ProxyRequest) => ProxyResponse): {
  vscode: VSCodeApi;
  received: Array<{ method: string; params: unknown }>;
} {
  const received: Array<{ method: string; params: unknown }> = [];
  const vscode: VSCodeApi = {
    postMessage: (data: unknown) => {
      const req = data as {
        jsonrpc: string;
        id: number;
        method: string;
        params: unknown[];
      };
      received.push({ method: req.method, params: req.params });
      const result = handler(req.params[0] as ProxyRequest);
      // Deliver asynchronously, mirroring the real cross-process hop.
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { jsonrpc: "2.0", id: req.id, result },
          })
        );
      });
    },
    getState: () => undefined,
    setState: () => {},
  };
  return { vscode, received };
}

const okJson = (body: unknown): ProxyResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  bodyEncoding: "utf8",
});

describe("apiVscode end-to-end over postMessage", () => {
  test("get_logs round-trips a GET carrying the construction dir", async () => {
    const { vscode, received } = connectFakeExtension((req) => {
      expect(req.method).toBe("GET");
      expect(req.path).toBe(
        `/api/log-files?log_dir=${encodeURIComponent("file:///logs/run-1")}`
      );
      return okJson({ files: [], response_type: "full" });
    });

    const listing = await apiVscode(
      vscode,
      "file:///logs/run-1",
      createVscodeProxyFetch(vscode)
    ).get_logs(0, 0);

    expect(listing.files).toEqual([]);
    expect(received[0]?.method).toBe("http_request");
  });

  test("get_log_bytes round-trips binary via base64", async () => {
    const { vscode } = connectFakeExtension((req) => {
      expect(req.method).toBe("GET");
      expect(req.path).toBe("/api/log-bytes/x.eval?start=0&end=3");
      return {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: btoa(String.fromCharCode(1, 2, 3)),
        bodyEncoding: "base64",
      };
    });

    const bytes = await apiVscode(
      vscode,
      "file:///logs",
      createVscodeProxyFetch(vscode)
    ).get_log_bytes("x.eval", 0, 3);

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  test("two instances over ONE transport answer for their own dirs", async () => {
    // The LogViewAPI contract, on the transport that motivated it: the host's
    // "current" dir must never leak into an instance's answers. The fake
    // extension answers every listing request with the dir it was asked
    // about, so any instance that failed to scope its request would get the
    // wrong files.
    const dirA = "file:///dir/a";
    const dirB = "file:///dir/b";
    const { vscode } = connectFakeExtension((req) => {
      const url = new URL(`vscode://host${req.path}`);
      const dir = url.searchParams.get("log_dir");
      return okJson({
        files: [{ name: `${dir}/only.eval` }],
        response_type: "full",
      });
    });

    const proxyFetch = createVscodeProxyFetch(vscode);
    const a = apiVscode(vscode, dirA, proxyFetch);
    const b = apiVscode(vscode, dirB, proxyFetch);

    const [listingA, listingB] = await Promise.all([
      a.get_logs(0, 0),
      b.get_logs(0, 0),
    ]);

    expect(listingA.files.map((f) => f.name)).toEqual([
      "file:///dir/a/only.eval",
    ]);
    expect(listingB.files.map((f) => f.name)).toEqual([
      "file:///dir/b/only.eval",
    ]);
  });
});
