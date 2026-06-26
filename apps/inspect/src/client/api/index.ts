import JSON5 from "json5";

import { AppConfig } from "@tsmono/inspect-common/types";
import { dirname, getVscodeApi, kMethodHttpRequest } from "@tsmono/util";

import { clientApi } from "./client-api";
import staticHttpApi from "./static-http/api-static-http";
import { ClientAPI } from "./types";
import { viewServerApi } from "./view-server/api-view-server";
import vscodeApi from "./vscode/api-vscode";
import { apiVscodeHttp } from "./vscode/api-vscode-http";
import { readHostCapabilities } from "./vscode/host-capabilities";

// Shape of the JSON embedded in the #log_dir_context script element.
interface LogDirContext {
  log_dir?: string;
  log_file?: string;
  abs_log_dir?: string;
  inspect_version?: string;
}

/**
 * Resolves the client API
 */
const resolveApi = (): ClientAPI => {
  const debug = false;
  const vscode = getVscodeApi();
  if (vscode) {
    // VS Code. Prefer the generic http_request proxy API when the extension
    // host advertises it; otherwise fall back to the legacy named-RPC API so
    // newer viewers keep working on older extensions.
    const capabilities = readHostCapabilities();
    const api = capabilities.includes(kMethodHttpRequest)
      ? apiVscodeHttp(vscode)
      : vscodeApi;
    return clientApi(api, undefined, debug);
  } else {
    // See if there is an log_file, log_dir embedded in the
    // document or passed via URL (could be hosted)
    const scriptEl = document.getElementById("log_dir_context");
    if (scriptEl) {
      // Read the contents
      const context = scriptEl.textContent;
      if (context !== null) {
        const data = JSON5.parse<LogDirContext>(context);
        if (data.log_dir || data.log_file) {
          const log_dir = data.log_dir || dirname(data.log_file ?? "");
          const app_config: AppConfig | undefined =
            data.inspect_version !== undefined
              ? {
                  inspect_version: data.inspect_version,
                  scout_version: null,
                }
              : undefined;
          const api = staticHttpApi(
            log_dir,
            data.log_file,
            data.abs_log_dir,
            app_config
          );
          return clientApi(api, data.log_file, debug);
        }
      }
    }

    // See if there is url params passing info (could be hosted)
    const urlParams = new URLSearchParams(window.location.search);
    const log_file = urlParams.get("log_file");
    const log_dir = urlParams.get("log_dir");
    const forceViewServerApi = urlParams.get("inspect_server") === "true";

    const resolved_log_dir = log_dir ?? undefined;
    const resolved_log_file = log_file ?? undefined;

    if (forceViewServerApi) {
      return clientApi(
        viewServerApi({ logDir: resolved_log_dir }),
        resolved_log_file,
        debug
      );
    }

    if (resolved_log_dir !== undefined || resolved_log_file !== undefined) {
      return clientApi(
        staticHttpApi(resolved_log_dir, resolved_log_file),
        resolved_log_file,
        debug
      );
    }

    // No signal information so use the standard
    // view server API (inspect view)
    return clientApi(viewServerApi(), undefined, debug);
  }
};

export default resolveApi();
