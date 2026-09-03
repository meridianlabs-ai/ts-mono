/**
 * VS Code API implementation for protocol version 2+.
 * Composes apiScoutServer (for HTTP calls via JSON-RPC proxy) with VS Code storage.
 */

import {
  createJsonRpcFetch,
  VSCodeApi,
  webViewJsonRpcClient,
} from "@tsmono/util";

import { ScoutApiV2 } from "./api";
import { apiScoutServer } from "./api-scout-server";
import { createVSCodeStore } from "./vscode-storage";

export const apiVscode = (vscodeApi: VSCodeApi): ScoutApiV2 => {
  const rpcClient = webViewJsonRpcClient(vscodeApi);
  const { downloadScan: _, ...serverApi } = apiScoutServer({
    customFetch: createJsonRpcFetch(rpcClient),
    disableSSE: true,
  });
  return {
    ...serverApi,
    storage: createVSCodeStore(vscodeApi),
    capability: "workbench",
  };
};
