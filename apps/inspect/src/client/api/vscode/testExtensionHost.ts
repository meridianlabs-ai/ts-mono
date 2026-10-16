/**
 * A fake VS Code extension host for tests: the far side of the webview's
 * JSON-RPC `http_request` proxy.
 */
import type { VSCodeApi } from "@tsmono/util";
import { isRecord } from "@tsmono/util";

export type ProxyRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
};
export type ProxyResponse = {
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
export function connectFakeExtension(
  handler: (req: ProxyRequest) => ProxyResponse
): {
  vscode: VSCodeApi;
  received: Array<{ method: string; params: unknown }>;
} {
  const asJsonRpcCall = (
    data: unknown
  ): { id: number; method: string; params: unknown[] } => {
    if (
      !isRecord(data) ||
      typeof data["id"] !== "number" ||
      typeof data["method"] !== "string" ||
      !Array.isArray(data["params"])
    ) {
      throw new Error(`not a JSON-RPC call: ${JSON.stringify(data)}`);
    }
    return {
      id: data["id"],
      method: data["method"],
      params: data["params"],
    };
  };

  const asProxyRequest = (value: unknown): ProxyRequest => {
    if (
      !isRecord(value) ||
      typeof value["method"] !== "string" ||
      typeof value["path"] !== "string"
    ) {
      throw new Error(`not a ProxyRequest: ${JSON.stringify(value)}`);
    }
    const headers = value["headers"];
    const body = value["body"];
    return {
      method: value["method"],
      path: value["path"],
      headers: isRecord(headers)
        ? Object.fromEntries(
            Object.entries(headers).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string"
            )
          )
        : undefined,
      body: typeof body === "string" ? body : undefined,
    };
  };

  const received: Array<{ method: string; params: unknown }> = [];
  const vscode: VSCodeApi = {
    postMessage: (data: unknown) => {
      const req = asJsonRpcCall(data);
      received.push({ method: req.method, params: req.params });
      const result = handler(asProxyRequest(req.params[0]));
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

export const okJson = (body: unknown): ProxyResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  bodyEncoding: "utf8",
});

/**
 * Make `vscode` the page's VS Code host, advertising `capabilities` the way
 * the extension injects them. Undo with `uninstallVscodeHost`.
 */
export const installVscodeHost = (
  vscode: VSCodeApi,
  capabilities?: string[]
): void => {
  window.acquireVsCodeApi = () => vscode;
  if (capabilities) {
    const el = document.createElement("script");
    el.id = "inspect-host-capabilities";
    el.type = "application/json";
    el.textContent = JSON.stringify(capabilities);
    document.body.appendChild(el);
  }
};

export const uninstallVscodeHost = (): void => {
  delete window.acquireVsCodeApi;
  document.getElementById("inspect-host-capabilities")?.remove();
};
