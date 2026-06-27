import type { LogFilesResponse } from "@tsmono/inspect-common/types";

import { LogLocationController } from "./log-location";
import {
  ClientAPI,
  LogPreview,
  PendingSampleResponse,
  SampleDataResponse,
} from "./types";

/**
 * Dispatches each operation to either the configured host/server client or the
 * browser-direct static client. File-bearing operations fail closed when the
 * location controller recognizes neither capability.
 */
export const locationAwareClientApi = (
  base: ClientAPI,
  browser: ClientAPI,
  locations: LogLocationController
): ClientAPI => {
  const listingClient = (): ClientAPI =>
    locations.usesBrowserListing() ? browser : base;

  const fileClient = (file: string): ClientAPI => {
    const transport = locations.transportForFile(file);
    if (transport === "browser") {
      return browser;
    }
    if (transport === "base") {
      return base;
    }
    throw new Error(`Log location is outside the active capability: ${file}`);
  };

  const get_log_summaries = async (files: string[]): Promise<LogPreview[]> => {
    const baseFiles: Array<{ file: string; index: number }> = [];
    const browserFiles: Array<{ file: string; index: number }> = [];
    files.forEach((file, index) => {
      const target = fileClient(file) === browser ? browserFiles : baseFiles;
      target.push({ file, index });
    });

    const result = new Array<LogPreview | undefined>(files.length);
    const loadBatch = async (
      client: ClientAPI,
      entries: Array<{ file: string; index: number }>
    ) => {
      if (entries.length === 0) {
        return;
      }
      const previews = await client.get_log_summaries(
        entries.map(({ file }) => file)
      );
      entries.forEach(({ index }, previewIndex) => {
        result[index] = previews[previewIndex];
      });
    };
    await Promise.all([
      loadBatch(base, baseFiles),
      loadBatch(browser, browserFiles),
    ]);
    return result.filter((preview): preview is LogPreview => !!preview);
  };

  const api: ClientAPI = {
    log_locations: locations,
    get_log_dir: () => listingClient().get_log_dir(),
    get_log_dir_handle: (logDir) => listingClient().get_log_dir_handle(logDir),
    get_logs: async (mtime, clientFileCount): Promise<LogFilesResponse> =>
      listingClient().get_logs(mtime, clientFileCount),
    get_log_root: () => listingClient().get_log_root(),
    get_eval_set: (dir) => listingClient().get_eval_set(dir),
    get_flow: (dir) => listingClient().get_flow(dir),
    get_log_summaries,
    get_log_details: async (file, cached) =>
      fileClient(file).get_log_details(file, cached),
    get_log_sample: async (file, id, epoch, onProgress) =>
      fileClient(file).get_log_sample(file, id, epoch, onProgress),
    client_events: () => listingClient().client_events(),
    log_message: async (file, message) => {
      const client = fileClient(file);
      await client.log_message?.(file, message);
    },
    download_file: (fileName, contents) =>
      listingClient().download_file(fileName, contents),
    open_log_file: (file, logDir) => base.open_log_file(file, logDir),
    get_app_config: () => listingClient().get_app_config(),
  };

  if (base.get_log_pending_samples || browser.get_log_pending_samples) {
    api.get_log_pending_samples = async (
      file: string,
      etag?: string
    ): Promise<PendingSampleResponse> => {
      const client = fileClient(file);
      if (!client.get_log_pending_samples) {
        return { status: "NotFound" };
      }
      return client.get_log_pending_samples(file, etag);
    };
  }

  if (base.get_log_sample_data || browser.get_log_sample_data) {
    api.get_log_sample_data = async (
      file,
      id,
      epoch,
      lastEvent,
      lastAttachment,
      lastMessagePool,
      lastCallPool
    ): Promise<SampleDataResponse | undefined> => {
      const client = fileClient(file);
      if (!client.get_log_sample_data) {
        return undefined;
      }
      return client.get_log_sample_data(
        file,
        id,
        epoch,
        lastEvent,
        lastAttachment,
        lastMessagePool,
        lastCallPool
      );
    };
  }

  if (base.download_log || browser.download_log) {
    api.download_log = async (file) => {
      const client = fileClient(file);
      if (!client.download_log) {
        throw new Error(
          "Downloading this browser-hosted log is not supported."
        );
      }
      return client.download_log(file);
    };
  }

  if (base.edit_log || browser.edit_log) {
    api.edit_log = async (file, update, etag) => {
      const client = fileClient(file);
      if (!client.edit_log) {
        throw new Error("Editing this browser-hosted log is not supported.");
      }
      return client.edit_log(file, update, etag);
    };
  }

  if (base.get_user_info || browser.get_user_info) {
    api.get_user_info = async () =>
      (await listingClient().get_user_info?.()) ?? {};
  }

  if (base.list_searches || browser.list_searches) {
    api.list_searches = async (searchType, count) => {
      const client = listingClient();
      if (!client.list_searches) {
        throw new Error("Search is not supported for browser-hosted logs.");
      }
      return client.list_searches(searchType, count);
    };
  }

  if (base.post_search || browser.post_search) {
    api.post_search = async (transcriptDir, transcriptId, request) => {
      const client = listingClient();
      if (!client.post_search) {
        throw new Error("Search is not supported for browser-hosted logs.");
      }
      return client.post_search(transcriptDir, transcriptId, request);
    };
  }

  if (base.get_search_result || browser.get_search_result) {
    api.get_search_result = async (
      transcriptDir,
      transcriptId,
      searchId,
      scope
    ) => {
      const client = listingClient();
      if (!client.get_search_result) {
        throw new Error("Search is not supported for browser-hosted logs.");
      }
      return client.get_search_result(
        transcriptDir,
        transcriptId,
        searchId,
        scope
      );
    };
  }

  return api;
};
