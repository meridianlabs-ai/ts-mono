import {
  AppConfig,
  EvalSet,
  LogFilesResponse,
} from "@tsmono/inspect-common/types";
import { fetchRange, isUri } from "@tsmono/util";

import { fetchSize } from "../../remote/remoteZipFile";
import { download_file } from "../shared/api-shared";
import { Capabilities, LogPreview, LogRoot, LogViewAPI } from "../types";

import {
  fetchJsonFile,
  fetchLogFile,
  fetchManifest,
  fetchTextFile,
  joinURI,
} from "./fetch";

/** The canonical, origin-unique URL of a deployment's log dir. A relative
 *  configured log_dir is page-relative for fetching, but page-relative
 *  strings are not identities: two bundles at different paths on one origin
 *  would collide in the shared per-origin IndexedDB. So everything the app
 *  sees (log_dir, file names) is absolute. */
const canonicalDirUrl = (log_dir: string): string => {
  if (isUri(log_dir)) {
    return log_dir;
  }
  const pageDir = `${window.location.origin}${window.location.pathname.substring(0, window.location.pathname.lastIndexOf("/"))}`;
  return joinURI(pageDir, log_dir);
};

// Versions aren't reachable without a server; older bundles don't embed them.
const kFallbackAppConfig: AppConfig = {
  inspect_version: "unknown",
  scout_version: null,
};

/**
 * Bootstrap: the log root a static deployment serves, resolved synchronously
 * from its configured dir — no api instance involved (dir discovery precedes
 * construction, see #392).
 */
export const staticLogRoot = (
  log_dir: string,
  abs_log_dir?: string
): LogRoot => ({
  logs: [],
  log_dir: canonicalDirUrl(log_dir.replace(/ /g, "+")),
  abs_log_dir,
});

/**
 * This provides an API implementation that will serve a single
 * file using an http parameter, designed to be deployed
 * to a webserver without inspect or the ability to enumerate log
 * files
 */
export default function staticHttpApi(
  log_dir: string,
  app_config?: AppConfig
): LogViewAPI {
  return staticHttpApiForLog({
    log_dir: log_dir.replace(/ /g, "+"),
    app_config,
  });
}

/**
 * Fetches a file from the specified URL and parses its content.
 */
function staticHttpApiForLog(logInfo: {
  log_dir: string;
  app_config?: AppConfig;
}): LogViewAPI {
  const log_dir = logInfo.log_dir;
  const canonical_log_dir = canonicalDirUrl(log_dir);
  const app_config = logInfo.app_config ?? kFallbackAppConfig;
  let manifest: Record<string, LogPreview> | undefined = undefined;
  // The same entries keyed by absolute log name, built once with the manifest
  // so per-file lookups during listing hydration are O(1) instead of a
  // joinURI per key per file.
  let manifestByName: Map<string, LogPreview> | undefined = undefined;
  let manifestPromise: Promise<Record<string, LogPreview>> | undefined =
    undefined;

  const getManifest = async (): Promise<Record<string, LogPreview>> => {
    if (!manifest) {
      if (!manifestPromise) {
        manifestPromise = fetchManifest(log_dir).then((manifestRaw) => {
          manifest = manifestRaw?.parsed || {};
          manifestByName = new Map(
            Object.entries(manifest).map(([key, preview]) => [
              joinURI(canonical_log_dir, key),
              preview,
            ])
          );
          return manifest;
        });
      }
      await manifestPromise;
    }
    return manifest || {};
  };

  // Manifest keys are log-dir-relative. The absolute name wins outright; the
  // fallback for a non-canonical absolute URL is the longest key that is a
  // whole trailing path, so `b.eval` never claims `.../xb.eval` and `a.eval`
  // never shadows `sub/a.eval`.
  const findPreview = (
    manifest: Record<string, LogPreview>,
    file: string
  ): LogPreview | undefined => {
    const exact = manifestByName?.get(file);
    if (exact) {
      return exact;
    }
    let key: string | undefined;
    for (const candidate of Object.keys(manifest)) {
      if (
        file.endsWith(`/${candidate}`) &&
        (key === undefined || candidate.length > key.length)
      ) {
        key = candidate;
      }
    }
    return key === undefined ? undefined : manifest[key];
  };

  async function open_log_file() {
    // No op
  }
  return {
    client_events: async () => {
      // There are no client events in the case of serving via
      // http
      return Promise.resolve([]);
    },
    get_logs: async (): Promise<LogFilesResponse> => {
      // No change detection against a static manifest — every listing is a
      // full response and the caller's mtime/count token is ignored.
      const manifest = await getManifest();
      const files = Object.entries(manifest).map(([key, preview]) => ({
        name: joinURI(canonical_log_dir, key),
        task: preview.task,
        task_id: preview.task_id,
      }));
      return { files, response_type: "full" };
    },
    get_eval_set: async (dir?: string) => {
      const dirSegments = [];
      if (log_dir) {
        dirSegments.push(log_dir);
      }
      if (dir) {
        dirSegments.push(dir);
      }

      const result = await fetchJsonFile<EvalSet>(
        joinURI(...dirSegments, "eval-set.json"),
        (response) => {
          if (400 <= response.status && response.status < 500) {
            // Couldn't find a header file
            return true;
          } else {
            return false;
          }
        }
      );
      return result;
    },
    get_flow: async (dir?: string) => {
      const dirSegments = [];
      if (log_dir) {
        dirSegments.push(log_dir);
      }
      if (dir) {
        dirSegments.push(dir);
      }

      return await fetchTextFile(
        joinURI(...dirSegments, "flow.yaml"),
        (response) => {
          if (400 <= response.status && response.status < 500) {
            // Couldn't find a flow file
            return true;
          } else {
            return false;
          }
        }
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
      const response = await fetchLogFile(log_file);
      if (response) {
        return response;
      } else {
        throw new Error(`"Unable to load eval log ${log_file}`);
      }
    },
    get_log_info: async (log_file: string) => {
      const size = await fetchSize(log_file);
      return { size };
    },
    get_log_bytes: async (log_file: string, start: number, end: number) => {
      return await fetchRange(log_file, start, end);
    },
    get_log_summary: async (log_file: string) => {
      const preview = findPreview(await getManifest(), log_file);
      if (preview) {
        return preview;
      }
      throw new Error(`Unable to load eval log header for ${log_file}`);
    },
    get_log_summaries: async (files: string[]) => {
      if (files.length === 0) {
        return [];
      }

      const manifest = await getManifest();
      const result: LogPreview[] = [];
      files.forEach((file) => {
        const preview = findPreview(manifest, file);
        if (preview) {
          result.push(preview);
        }
      });
      return result;
    },
    get_app_config: () => Promise.resolve(app_config),
    download_file,
    open_log_file,
  };
}
