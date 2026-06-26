import { describe, expect, test, vi } from "vitest";

import { createJsonRpcFetch, HttpProxyRequest } from "./jsonrpc-fetch";
import { kMethodHttpRequest } from "./jsonrpc";

describe("createJsonRpcFetch", () => {
  test("serializes a GET into an http_request RPC and rebuilds the Response", async () => {
    const seen: Array<{ method: string; params?: unknown }> = [];
    const rpcClient = vi.fn((method: string, params?: unknown) => {
      seen.push({ method, params });
      return Promise.resolve({
        status: 200,
        headers: { "content-type": "application/json" },
        body: '{"ok":true}',
        bodyEncoding: "utf8",
      });
    });

    const proxyFetch = createJsonRpcFetch(rpcClient);
    const res = await proxyFetch("/api/logs", { method: "GET" });

    expect(seen[0]?.method).toBe(kMethodHttpRequest);
    const req = (seen[0]?.params as [HttpProxyRequest])[0];
    expect(req).toMatchObject({ method: "GET", path: "/api/logs" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
  });

  test("decodes a base64 body back into bytes", async () => {
    const rpcClient = vi.fn(() =>
      Promise.resolve({
        status: 200,
        headers: {},
        body: btoa("abc"),
        bodyEncoding: "base64",
      })
    );
    const proxyFetch = createJsonRpcFetch(rpcClient);
    const res = await proxyFetch("/api/log-bytes/x?start=0&end=3", {
      method: "GET",
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([97, 98, 99]);
  });

  test("forwards the request body as a string", async () => {
    const seen: Array<{ params?: unknown }> = [];
    const rpcClient = vi.fn((_method: string, params?: unknown) => {
      seen.push({ params });
      return Promise.resolve({ status: 200, headers: {}, body: "", bodyEncoding: "utf8" });
    });
    const proxyFetch = createJsonRpcFetch(rpcClient);
    await proxyFetch("/api/log-edit/x", {
      method: "POST",
      body: JSON.stringify({ tags: ["a"] }),
    });
    const req = (seen[0]?.params as [HttpProxyRequest])[0];
    expect(req.method).toBe("POST");
    expect(req.body).toBe('{"tags":["a"]}');
  });

  test("rejects when the RPC response is not a valid HttpProxyResponse", async () => {
    const rpcClient = vi.fn(() => Promise.resolve({ nope: true }));
    const proxyFetch = createJsonRpcFetch(rpcClient);
    await expect(proxyFetch("/api/x", { method: "GET" })).rejects.toThrow(
      /Invalid HTTP proxy response/
    );
  });
});
