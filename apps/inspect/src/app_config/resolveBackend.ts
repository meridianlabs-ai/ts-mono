import JSON5 from "json5";

import { AppConfig } from "@tsmono/inspect-common/types";
import { dirname, getVscodeApi, kMethodHttpRequest } from "@tsmono/util";

import { clientApi } from "../client/api/client-api";
import staticHttpApi, {
  staticLogRoot,
} from "../client/api/static-http/api-static-http";
import { ClientAPI, LogRoot } from "../client/api/types";
import {
  fetchViewServerLogDir,
  fetchViewServerLogRoot,
  viewServerApi,
} from "../client/api/view-server/api-view-server";
import {
  apiVscodeHttp,
  createVscodeProxyFetch,
} from "../client/api/vscode/api-vscode-http";
import { readHostCapabilities } from "../client/api/vscode/host-capabilities";

import { UrlLogSource } from "./urlLogSource";

// Shape of the JSON embedded in the #log_dir_context script element.
interface LogDirContext {
  log_dir?: string;
  log_file?: string;
  abs_log_dir?: string;
  inspect_version?: string;
}

/** Transport facts knowable before any api instance exists — what the store
 *  capabilities need at boot (main.tsx runs above the config gate). */
export interface BackendCapabilities {
  downloadLogs: boolean;
  streamSamples: boolean;
}

/**
 * A backend's bootstrap: how to discover the log dir, and how to build a
 * `ClientAPI` once it's known. Dir discovery and construction are separate
 * stages by design (#392) — an api instance is immutable per dir, so the dir
 * must exist first, and a dir change means calling `createApi` again (see
 * `setLogRoot`). `createApi` is the seam an embedder-supplied api factory
 * plugs into (see PR #473).
 */
export interface BackendBootstrap {
  /** Discover the log root (dir mode). Runs once, before any `ClientAPI`. */
  resolveLogRoot: () => Promise<LogRoot | undefined>;
  /** The backend's configured dir, for resolving a bare single-file ref
   *  (`?log_file=foo.eval`). Absent when the backend has no such notion. */
  resolveConfiguredDir?: () => Promise<string | undefined>;
  /** Pure per-dir construction: same transport, different dir → independent
   *  instances. */
  createApi: (logDir: string) => ClientAPI;
  capabilities: BackendCapabilities;
}

// A backend that can't work at all (e.g. legacy VS Code host). Constructed
// instead of throwing from resolveBackend so the error surfaces through the
// config gate's error UI rather than crashing the pre-render boot path.
const unsupportedHostBackend = (message: string): BackendBootstrap => ({
  resolveLogRoot: () => Promise.reject(new Error(message)),
  createApi: () => {
    throw new Error(message);
  },
  capabilities: { downloadLogs: false, streamSamples: false },
});

const viewServerBackend = (logDirHint?: string): BackendBootstrap => ({
  resolveLogRoot: () => fetchViewServerLogRoot({}, logDirHint),
  resolveConfiguredDir: () => fetchViewServerLogDir(),
  createApi: (logDir) => clientApi(viewServerApi({ logDir })),
  capabilities: { downloadLogs: true, streamSamples: true },
});

const staticBackend = (
  log_dir?: string,
  log_file?: string,
  abs_log_dir?: string,
  app_config?: AppConfig
): BackendBootstrap => ({
  resolveLogRoot: () =>
    log_dir
      ? Promise.resolve(staticLogRoot(log_dir, abs_log_dir))
      : Promise.reject(new Error("Unable to determine log paths.")),
  createApi: (logDir) =>
    clientApi(staticHttpApi(logDir, log_file, abs_log_dir, app_config)),
  capabilities: { downloadLogs: false, streamSamples: false },
});

/**
 * Resolves the backend bootstrap from the invocation-time log source (see
 * `app_config/urlLogSource.ts`) plus the ambient signals (vscode host,
 * embedded `#log_dir_context`, `?inspect_server=true`). Called once, by
 * `resolveBootstrap()`.
 */
export const resolveBackend = (source: UrlLogSource): BackendBootstrap => {
  const vscode = getVscodeApi();
  if (vscode) {
    // VS Code runs either single-file (the extension embeds a `#logview-state`
    // for an opened log) or directory mode (the sidebar view carries a log_dir
    // with nothing selected, so no `#logview-state` is injected). All data
    // calls ride the generic `http_request` JSON-RPC proxy; a host without it
    // can't scope requests to a dir (the LogViewAPI contract), so the legacy
    // named-RPC fallback is gone — surface an actionable error instead.
    const capabilities = readHostCapabilities();
    if (!capabilities.includes(kMethodHttpRequest)) {
      return unsupportedHostBackend(
        "This version of the log viewer requires a newer Inspect AI extension. " +
          "Please update the Inspect AI extension in VS Code."
      );
    }
    const proxyFetch = createVscodeProxyFetch(vscode);
    return {
      resolveLogRoot: () =>
        fetchViewServerLogRoot({ customFetch: proxyFetch }),
      createApi: (logDir) =>
        clientApi(apiVscodeHttp(vscode, logDir, proxyFetch)),
      capabilities: { downloadLogs: false, streamSamples: true },
    };
  }

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
        return staticBackend(
          log_dir,
          data.log_file,
          data.abs_log_dir,
          app_config
        );
      }
    }
  }

  // See if there is url params passing info (could be hosted)
  const urlParams = new URLSearchParams(window.location.search);
  const forceViewServerApi = urlParams.get("inspect_server") === "true";

  const resolved_log_dir = source.kind === "dir" ? source.logDir : undefined;
  const resolved_log_file = source.kind === "file" ? source.logFile : undefined;

  if (forceViewServerApi) {
    return viewServerBackend(resolved_log_dir);
  }

  if (resolved_log_dir !== undefined || resolved_log_file !== undefined) {
    return staticBackend(resolved_log_dir, resolved_log_file);
  }

  // No signal information so use the standard
  // view server API (inspect view)
  return viewServerBackend();
};
