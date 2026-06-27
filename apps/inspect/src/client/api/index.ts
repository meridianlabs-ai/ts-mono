import JSON5 from "json5";

import { AppConfig } from "@tsmono/inspect-common/types";
import { getVscodeApi } from "@tsmono/util";

import { clientApi } from "./client-api";
import { locationAwareClientApi } from "./location-aware-client-api";
import { LogLocationController } from "./log-location";
import staticHttpApi from "./static-http/api-static-http";
import { ClientAPI, LogViewAPI } from "./types";
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
 * Resolve transport only from trusted environment signals. URL parameters are
 * inspected by the location controller as untrusted selections after the
 * clients have been constructed.
 */
export const resolveApi = (): ClientAPI => {
  const debug = false;
  const vscode = getVscodeApi();
  const embedded = vscode ? undefined : readLogDirContext();

  let locations: LogLocationController;
  let baseViewApi: LogViewAPI;
  let browserViewApi: LogViewAPI;

  if (vscode) {
    locations = new LogLocationController({
      transport: "vscode",
      baseUrl: document.baseURI,
    });
    baseViewApi = vscodeApi;
    browserViewApi = staticHttpApi(
      undefined,
      undefined,
      undefined,
      undefined,
      locations
    );
  } else if (embedded && (embedded.log_dir || embedded.log_file)) {
    locations = new LogLocationController({
      transport: "static",
      baseUrl: document.baseURI,
      staticLogDir: embedded.log_dir,
      staticLogFile: embedded.log_file,
    });
    const appConfig: AppConfig | undefined =
      embedded.inspect_version !== undefined
        ? {
            inspect_version: embedded.inspect_version,
            scout_version: null,
          }
        : undefined;
    browserViewApi = staticHttpApi(
      embedded.log_dir,
      embedded.log_file,
      embedded.abs_log_dir,
      appConfig,
      locations
    );
    baseViewApi = browserViewApi;
  } else {
    locations = new LogLocationController({
      transport: "view-server",
      baseUrl: document.baseURI,
    });
    baseViewApi = viewServerApi();
    browserViewApi = staticHttpApi(
      undefined,
      undefined,
      undefined,
      undefined,
      locations
    );
  }

  const browserClient = clientApi(browserViewApi, undefined, debug);
  const baseClient =
    baseViewApi === browserViewApi
      ? browserClient
      : clientApi(baseViewApi, undefined, debug);
  const api = locationAwareClientApi(baseClient, browserClient, locations);

  locations.initializeUrlSelection(window.location.search);
  return api;
};

function readLogDirContext(): LogDirContext | undefined {
  const scriptEl = document.getElementById("log_dir_context");
  const context = scriptEl?.textContent;
  if (!context) {
    return undefined;
  }

  const value = JSON5.parse<unknown>(context);
  if (!isRecord(value)) {
    throw new Error("Invalid embedded log directory configuration.");
  }

  return {
    log_dir: optionalString(value.log_dir),
    log_file: optionalString(value.log_file),
    abs_log_dir: optionalString(value.abs_log_dir),
    inspect_version: optionalString(value.inspect_version),
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default resolveApi();
