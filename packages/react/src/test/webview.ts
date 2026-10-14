import type { VSCodeApi } from "@tsmono/util";

/** Install with Playwright addInitScript; sessionStorage stands in for panel-owned state. */
export function installWebviewHost(): void {
  const stateKey = "test-webview-state";
  const reply = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { data }));
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

  async function request(message: Record<string, unknown>): Promise<void> {
    if (message.method !== "http_request" || !Array.isArray(message.params)) {
      throw new Error(`Unexpected host request: ${String(message.method)}`);
    }
    const input: unknown = message.params[0];
    if (!isRecord(input) || typeof input.path !== "string") {
      throw new Error("Invalid HTTP proxy request");
    }
    const headers = new Headers();
    if (isRecord(input.headers)) {
      for (const [key, value] of Object.entries(input.headers)) {
        if (typeof value === "string") headers.set(key, value);
      }
    }
    const response = await fetch(input.path, {
      method: typeof input.method === "string" ? input.method : "GET",
      headers,
      body: typeof input.body === "string" ? input.body : undefined,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    reply({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: btoa(binary),
        bodyEncoding: "base64",
      },
    });
  }

  const api: VSCodeApi = {
    getState: () => {
      const saved = sessionStorage.getItem(stateKey);
      const parsed: unknown = saved === null ? undefined : JSON.parse(saved);
      return parsed;
    },
    setState: (state) =>
      sessionStorage.setItem(stateKey, JSON.stringify(state)),
    postMessage: (message) => {
      if (!isRecord(message) || message.jsonrpc !== "2.0") return;
      request(message).catch((error: unknown) => {
        reply({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32603, message: String(error) },
        });
      });
    },
  };
  window.acquireVsCodeApi = () => api;
}

/** Insert host bootstrap data before module scripts execute. */
export function withWebviewBootstrap(
  html: string,
  elements: Record<string, unknown>
): string {
  const scripts = Object.entries(elements)
    .map(
      ([id, value]) =>
        `<script type="application/json" id="${id}">${JSON.stringify(value).replaceAll("<", "\\u003c")}</script>`
    )
    .join("");
  return html.replace("</head>", `${scripts}</head>`);
}
