import { AppConfig, EvalSet } from "@tsmono/inspect-common/types";
import { fetchRange } from "@tsmono/util";

import { openRemoteLogFile } from "../../remote/remoteLogFile";
import { fetchSize } from "../../remote/remoteZipFile";
import { toLogPreview } from "../../utils/type-utils";
import { grantedLogUrlHref, LogLocationController } from "../log-location";
import { download_file } from "../shared/api-shared";
import { Capabilities, LogPreview, LogRoot, LogViewAPI } from "../types";

import {
  fetchJsonFile,
  fetchLogFile,
  fetchManifest,
  fetchTextFile,
  staticLogRequestInit,
} from "./fetch";

// Versions aren't reachable without a server; older bundles don't embed them.
const kFallbackAppConfig: AppConfig = {
  inspect_version: "unknown",
  scout_version: null,
};

/**
 * Browser-direct log API. Every request is resolved through the shared
 * location controller immediately before the network call.
 */
export default function staticHttpApi(
  log_dir?: string,
  log_file?: string,
  abs_log_dir?: string,
  app_config?: AppConfig,
  locations?: LogLocationController
): LogViewAPI {
  const locationController =
    locations ??
    new LogLocationController({
      transport: "static",
      baseUrl:
        typeof document !== "undefined"
          ? document.baseURI
          : "http://localhost/",
      staticLogDir: log_dir,
      staticLogFile: log_file,
    });

  return staticHttpApiForLocations({
    locations: locationController,
    abs_log_dir,
    app_config,
  });
}

function staticHttpApiForLocations(options: {
  locations: LogLocationController;
  abs_log_dir?: string;
  app_config?: AppConfig;
}): LogViewAPI {
  const { locations, abs_log_dir } = options;
  const app_config = options.app_config ?? kFallbackAppConfig;

  let manifestRoot: string | undefined;
  let manifestPromise: Promise<Map<string, LogPreview>> | undefined = undefined;

  const getManifest = async (): Promise<Map<string, LogPreview>> => {
    const logDir = locations.getActiveBrowserDirectory();
    if (!logDir) {
      return new Map();
    }

    if (manifestRoot !== logDir) {
      manifestRoot = logDir;
      manifestPromise = undefined;
    }

    if (!manifestPromise) {
      manifestPromise = fetchManifest(
        locations.requireAuxiliaryFile("listing.json")
      ).then((manifestRaw) => {
        const result = new Map<string, LogPreview>();
        let invalidEntries = 0;
        for (const [key, preview] of Object.entries(
          manifestRaw?.parsed ?? {}
        )) {
          try {
            const file = grantedLogUrlHref(locations.requireManifestEntry(key));
            if (result.has(file)) {
              throw new Error(
                `Duplicate static log entry resolves to ${file}: ${key}`
              );
            }
            result.set(file, preview);
          } catch (error) {
            invalidEntries++;
            if (invalidEntries <= 5) {
              console.warn(`Ignoring invalid static log entry ${key}`, error);
            }
          }
        }
        if (invalidEntries > 5) {
          console.warn(
            `Ignored ${invalidEntries - 5} additional invalid static log entries.`
          );
        }
        return result;
      });
    }

    return manifestPromise;
  };

  const get_log_root = async (): Promise<LogRoot | undefined> => {
    const logDir = locations.getActiveBrowserDirectory();
    if (logDir) {
      const manifest = await getManifest();
      return {
        logs: Array.from(manifest.entries()).map(([name, preview]) => ({
          name,
          task: preview.task,
          task_id: preview.task_id,
        })),
        log_dir: logDir,
        abs_log_dir,
      };
    }

    const logFile = locations.getActiveBrowserFile();
    if (logFile) {
      return {
        logs: [{ name: logFile }],
        log_dir: directoryUrl(logFile),
        abs_log_dir,
      };
    }

    return undefined;
  };

  const get_log_summary = async (log_file: string): Promise<LogPreview> => {
    const grantedUrl = locations.requireBrowserFile(log_file);
    const granted = grantedLogUrlHref(grantedUrl);
    const manifest = await getManifest();
    const preview = manifest.get(granted);
    if (preview) {
      return preview;
    }

    if (new URL(granted).pathname.toLowerCase().endsWith(".json")) {
      const response = await fetchLogFile(grantedUrl);
      if (response) {
        return toLogPreview(response.parsed);
      }
    } else {
      const remote = await openRemoteLogFile(api, granted, 5);
      return remote.readEvalBasicInfo();
    }

    throw new Error(`Unable to load eval log header for ${log_file}`);
  };

  const api: LogViewAPI = {
    client_events: () => Promise.resolve([]),
    get_log_root,
    get_log_dir_handle: (logDir: string | undefined): string =>
      logDir ??
      locations.getActiveBrowserDirectory() ??
      directoryUrl(locations.getActiveBrowserFile()),
    get_eval_set: async (dir?: string) => {
      if (!locations.getActiveBrowserDirectory()) {
        return undefined;
      }
      return fetchJsonFile<EvalSet>(
        locations.requireAuxiliaryFile(dir, "eval-set.json"),
        (response) => response.status >= 400 && response.status < 500
      );
    },
    get_flow: async (dir?: string) => {
      if (!locations.getActiveBrowserDirectory()) {
        return undefined;
      }
      return fetchTextFile(
        locations.requireAuxiliaryFile(dir, "flow.yaml"),
        (response) => response.status >= 400 && response.status < 500
      );
    },
    log_message: (log_file: string, message: string) => {
      console.log(`[CLIENT MESSAGE] (${log_file}): ${message}`);
      return Promise.resolve();
    },
    get_log_contents: async (
      log_file: string,
      _headerOnly?: number,
      _capabilities?: Capabilities
    ) => {
      const response = await fetchLogFile(
        locations.requireBrowserFile(log_file)
      );
      if (!response) {
        throw new Error(`Unable to load eval log ${log_file}`);
      }
      return response;
    },
    get_log_info: async (log_file: string) => {
      const granted = locations.requireBrowserFile(log_file);
      return {
        size: await fetchSize(
          grantedLogUrlHref(granted),
          staticLogRequestInit,
          () => {
            grantedLogUrlHref(granted);
          }
        ),
      };
    },
    get_log_bytes: async (log_file: string, start: number, end: number) =>
      fetchRange(
        grantedLogUrlHref(locations.requireBrowserFile(log_file)),
        start,
        end,
        staticLogRequestInit
      ),
    get_log_summary,
    get_log_summaries: async (files: string[]) =>
      Promise.all(files.map((file) => get_log_summary(file))),
    get_app_config: () => Promise.resolve(app_config),
    download_file,
    open_log_file: async () => {},
  };

  return api;
}

function directoryUrl(file: string | undefined): string {
  if (!file) {
    return "default_log_dir";
  }
  const url = new URL(file);
  url.pathname = url.pathname.substring(0, url.pathname.lastIndexOf("/") + 1);
  url.search = "";
  url.hash = "";
  return url.href;
}
