import JSON5 from "json5";

import { AppConfig } from "@tsmono/inspect-common/types";
import { dirname, getVscodeApi } from "@tsmono/util";

import { isSingleFileMode } from "../../app/singleFileMode";

import { clientApi } from "./client-api";
import staticHttpApi from "./static-http/api-static-http";
import { ClientAPI } from "./types";
import { viewServerApi } from "./view-server/api-view-server";
import vscodeApi from "./vscode/api-vscode";

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
  if (getVscodeApi()) {
    // VS Code ≡ single-file mode: the extension always embeds a single log
    // (`#logview-state`), which trips single-file mode. Directory + VS Code is
    // structurally reachable but not a real combo, and the directory loader
    // relies on a defined `log_dir` — so enforce the invariant here rather than
    // let it silently render an empty directory view. See
    // design/migration/replication-startup-modes.md ¹.
    if (!isSingleFileMode) {
      throw new Error(
        "VS Code backend resolved without single-file mode (expected an embedded #logview-state element)."
      );
    }
    return clientApi(vscodeApi, undefined, debug);
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
