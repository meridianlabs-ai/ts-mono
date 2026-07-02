import { LogHandle } from "@tsmono/inspect-common";

import { ClientAPI } from "../client/api/types";

import { FetchEngine } from "./fetchEngine";

/**
 * Directory discovery: list the log dir, diff it against the known listing
 * (new / changed / deleted), and produce the result into the fetch engine —
 * which owns all fetching, persistence, and prioritization. Dir mode only;
 * never started in single-file sessions.
 */
export class ReplicationService {
  private _api: ClientAPI | undefined = undefined;
  private _engine: FetchEngine | undefined = undefined;

  // Track sync requests (so we wait on already running requests before syncing again)
  private _pendingSync: Promise<LogHandle[]> | null = null;
  private _syncQueued: boolean = false;

  public startReplication(api: ClientAPI, engine: FetchEngine): void {
    this._api = api;
    this._engine = engine;
  }

  public stopReplication(): void {
    this._api = undefined;
    this._engine = undefined;
  }

  public isReplicating(): boolean {
    return !!this._api && !!this._engine;
  }

  public async sync(): Promise<LogHandle[]> {
    // If sync is running and another is already queued, just wait for the queued one
    if (this._pendingSync && this._syncQueued) {
      return this._pendingSync;
    }

    // If sync is running but none queued, queue this one
    if (this._pendingSync) {
      this._syncQueued = true;
      await this._pendingSync;
      this._syncQueued = false;
      // After pending completes, run one more sync
      return this.sync();
    }

    // No sync running, execute immediately
    this._pendingSync = this._syncImpl();

    try {
      return await this._pendingSync;
    } finally {
      this._pendingSync = null;
    }
  }

  private async _syncImpl(): Promise<LogHandle[]> {
    if (!this._api || !this._engine) {
      throw new Error("Replication not started.");
    }
    const api = this._api;
    const engine = this._engine;

    const localFiles = engine.listing();
    const mtime = Math.max(0, ...localFiles.map((file) => file.mtime || 0));

    // A local listing with no mtime data is just a static list — no
    // incremental sync is possible, only a wholesale compare of names.
    const staticList = localFiles.length > 0 && mtime === 0;
    if (staticList) {
      const serverLogs = await api.get_logs(0, 0);
      const localNames = new Set(localFiles.map((file) => file.name));
      const changed =
        serverLogs.files.length !== localFiles.length ||
        serverLogs.files.some((file) => !localNames.has(file.name));

      if (changed) {
        // Invalidate everything and activate the new list.
        return engine.applyListing({
          listing: serverLogs.files,
          invalidated: localFiles.map((file) => file.name),
          deleted: [],
          persistListing: false,
        });
      }
      // Unchanged: re-activate the current listing (backfilling any gaps).
      return engine.applyListing({
        listing: localFiles,
        invalidated: [],
        deleted: [],
        persistListing: false,
      });
    }

    // Fetch the updated list of logs from the server
    const response = await api.get_logs(mtime, localFiles.length);
    const updatedLogs = response.files;

    const deleted =
      response.response_type === "full"
        ? localFiles
            .filter(
              (current) => !updatedLogs.find((f) => f.name === current.name)
            )
            .map((file) => file.name)
        : [];

    // Files that are new, or whose remote mtime is newer than the local copy
    // (or whose mtimes are missing, in which case assume changed).
    const invalidated = updatedLogs
      .filter((remoteLog) => {
        const localCopy = localFiles.find((f) => f.name === remoteLog.name);
        if (!localCopy) {
          return true;
        }
        if (remoteLog.mtime && localCopy.mtime) {
          return remoteLog.mtime > localCopy.mtime;
        }
        return true;
      })
      .map((file) => file.name);

    return engine.applyListing({
      listing: updatedLogs,
      invalidated,
      deleted,
      persistListing: true,
    });
  }
}

/**
 * Shared ReplicationService singleton. It's a server-replication helper, not
 * client state, so it lives as a module singleton (like `queryClient`) rather
 * than in the zustand store. Born inert; `startReplication(api, engine)`
 * injects its dependencies.
 */
export const replicationService = new ReplicationService();
