// @vitest-environment jsdom
import { describe, expect, test } from "vitest";

import { apiVscode, createVscodeProxyFetch } from "./api-vscode";
import {
  connectFakeExtension,
  okJson,
  type ProxyRequest,
} from "./testExtensionHost";

describe("apiVscode end-to-end over postMessage", () => {
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

  test("two instances over ONE transport GET listings for their own dirs", async () => {
    // The LogViewAPI contract, on the transport that motivated it: the host's
    // "current" dir must never leak into an instance's answers. The fake
    // extension answers every listing request with the dir it was asked
    // about, so any instance that failed to scope its request would get the
    // wrong files.
    const dirA = "file:///dir/a";
    const dirB = "file:///dir/b";
    const requests: ProxyRequest[] = [];
    const { vscode, received } = connectFakeExtension((req) => {
      requests.push(req);
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
    expect(received.map((r) => r.method)).toEqual([
      "http_request",
      "http_request",
    ]);
    expect(requests.map((r) => [r.method, r.path]).sort()).toEqual([
      ["GET", `/api/log-files?log_dir=${encodeURIComponent(dirA)}`],
      ["GET", `/api/log-files?log_dir=${encodeURIComponent(dirB)}`],
    ]);
  });
});
