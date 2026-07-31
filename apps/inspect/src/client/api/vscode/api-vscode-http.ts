import {
  createJsonRpcFetch,
  VSCodeApi,
  webViewJsonRpcClient,
} from "@tsmono/util";

import { LogViewAPI } from "../types";
import { viewServerApi } from "../view-server/api-view-server";

/**
 * The `fetch` that rides the extension's generic `http_request` JSON-RPC
 * proxy. The JSON-RPC client registers a window message listener, so build
 * this ONCE per host and share it across the bootstrap probe and every
 * per-dir api instance — a per-instance client would leak a listener on
 * each dir switch.
 */
export function createVscodeProxyFetch(vscode: VSCodeApi): typeof fetch {
  return createJsonRpcFetch(webViewJsonRpcClient(vscode));
}

/**
 * VS Code API bound to `logDir`, routing all data calls through the generic
 * `http_request` JSON-RPC proxy (mirrors apps/scout/src/api/api-vscode.ts).
 * Only genuine host actions and the disabled live-event channel are
 * overridden. Because the underlying view-server api scopes every request
 * with `?log_dir=`, answers never depend on the host's current selection.
 */
export function apiVscodeHttp(
  vscode: VSCodeApi,
  logDir: string,
  proxyFetch: typeof fetch = createVscodeProxyFetch(vscode)
): LogViewAPI {
  const serverApi = viewServerApi({
    logDir,
    customFetch: proxyFetch,
  });

  // Host action: open a log file in the editor. One-way message handled by the
  // extension's handleWebviewPanelOpenMessages — no server equivalent.
  const open_log_file = (log_file: string, log_dir: string): Promise<void> => {
    vscode.postMessage({ type: "displayLogFile", url: log_file, log_dir });
    return Promise.resolve();
  };

  const download_file = (): Promise<void> => {
    throw new Error("Downloading files is not supported in VS Code");
  };

  // Live client-event polling is disabled in VS Code (mirrors Scout's
  // disableSSE).
  const client_events = (): Promise<string[]> => Promise.resolve([]);

  // download_log triggers a browser navigation that can't ride the proxy; drop it.
  // eval_log_sample_data_direct reads presigned S3 URLs with the global fetch,
  // bypassing the proxy — those direct requests are blocked under webview CSP,
  // so drop it to keep sample-data polling on the proxied eval_log_sample_data path.
  const {
    download_log: _download_log,
    eval_log_sample_data_direct: _eval_log_sample_data_direct,
    ...rest
  } = serverApi;

  return {
    ...rest,
    client_events,
    open_log_file,
    download_file,
  };
}
