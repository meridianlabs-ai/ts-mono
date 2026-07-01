import { LogHandle } from "@tsmono/inspect-common";
import { throttle } from "@tsmono/util";

import { ClientAPI, LogDetails, LogPreview } from "../../client/api/types";
import { DatabaseService } from "../../client/database";
import { WorkPriority, WorkQueue } from "../../utils/workQueue";
import * as logsContent from "../logsContent";

/**
 * The non-cache bridges from the replicator to app state. Log-list content
 * (handles / previews / details) is written through the `logsContent` seam
 * directly — IndexedDB and the react-query cache as one operation — so it is
 * deliberately not part of this context.
 */
export interface ApplicationContext {
  setLoading: (loading: boolean) => void;
  setBackgroundSyncing: (syncing: boolean) => void;
  setDbStats: (stats: {
    logCount: number;
    previewCount: number;
    detailsCount: number;
  }) => void;
}

export class ReplicationService {
  // For remote data retrieval
  private _api: ClientAPI | undefined = undefined;

  // For storage
  private _database: DatabaseService | undefined = undefined;

  // The cache-key directory for the active session (distinct from the database
  // handle); the `logsContent` seam keys its react-query writes by this. Set by
  // startReplication; read via requireLogDir (the seam only runs post-start).
  private _dir: string | undefined = undefined;

  private requireLogDir(): string {
    if (this._dir === undefined) {
      throw new Error("Replication accessed before startReplication");
    }
    return this._dir;
  }

  // To update application state
  private _applicationContext: ApplicationContext | undefined = undefined;

  // The work queues
  private _previewQueue: WorkQueue<LogHandle, LogPreview>;
  private _detailQueue: WorkQueue<LogHandle, LogDetails>;
  private _processingCount: number;

  // Track sync requests (so we wait on already running requests before syncing again)
  private _pendingSync: Promise<LogHandle[]> | null = null;
  private _syncQueued: boolean = false;

  // Batched DB updates
  private _pendingPreviewUpdates: Record<string, LogPreview> = {};
  private _pendingDetailUpdates: Record<string, LogDetails> = {};
  private _flushingPreview = false;
  private _flushingDetail = false;
  private _throttledFlushPreviewBatch: () => void;
  private _throttledFlushDetailBatch: () => void;
  private _throttledUpdateDbStats: () => void;

  constructor() {
    this._processingCount = 0;
    this._throttledUpdateDbStats = throttle(
      () => void this.updateDbStats(),
      1000
    );
    this._throttledFlushPreviewBatch = throttle(
      () => void this.flushPreviewBatch(),
      250
    );
    this._throttledFlushDetailBatch = throttle(
      () => void this.flushDetailBatch(),
      250
    );

    this._previewQueue = new WorkQueue<LogHandle, LogPreview>({
      name: "Log-Preview-Queue",
      concurrency: 2,
      batchSize: 24,
      processingDelay: 20,
      onProcessingChanged: this.processingChanged,
      getId: (log) => log.name,
      worker: async (logHandles: LogHandle[]) => {
        if (!this._api) {
          throw new Error("API not available");
        }

        const previews = await this._api.get_log_summaries(
          logHandles.map((log) => log.name)
        );

        return previews;
      },
      onComplete: (previews: LogPreview[], inputs: LogHandle[]) => {
        // Add to pending batch
        inputs.forEach((log, i) => {
          if (previews[i]) {
            this._pendingPreviewUpdates[log.name] = previews[i];
          }
        });

        // Schedule batched update
        this._throttledFlushPreviewBatch();
        return Promise.resolve();
      },
    });

    this._detailQueue = new WorkQueue<LogHandle, LogDetails>({
      name: "Log-Detail-Queue",
      concurrency: 24,
      batchSize: 1,
      processingDelay: 0,
      onProcessingChanged: this.processingChanged,
      getId: (log) => log.name,
      worker: async (logHandles: LogHandle[]) => {
        if (!this._api) throw new Error("API not available");

        const details = await Promise.all(
          logHandles.map(async (log) => {
            try {
              const result = await this._api!.get_log_details(log.name);
              return result;
            } catch {
              return undefined;
            }
          })
        );

        const allResults = details.filter((d) => d !== undefined);
        return allResults;
      },
      onComplete: (details: LogDetails[], inputs: LogHandle[]) => {
        // Add to pending batch
        inputs.forEach((log, i) => {
          if (details[i]) {
            this._pendingDetailUpdates[log.name] = details[i];
          }
        });

        // Schedule batched update
        this._throttledFlushDetailBatch();
        return Promise.resolve();
      },
    });
  }

  processingChanged = (processing: boolean) => {
    this._processingCount += processing ? 1 : -1;
    if (this._processingCount > 0) {
      this._applicationContext?.setBackgroundSyncing(true);
    } else {
      this._applicationContext?.setBackgroundSyncing(false);
    }
  };

  private async flushPreviewBatch() {
    if (this._flushingPreview) {
      return;
    }
    this._flushingPreview = true;

    try {
      const updates = { ...this._pendingPreviewUpdates };
      this._pendingPreviewUpdates = {};

      if (Object.keys(updates).length === 0) {
        return;
      }

      await logsContent
        .writePreviews(this._database, this.requireLogDir(), updates)
        .catch(() => {});
      this._throttledUpdateDbStats();
    } finally {
      this._flushingPreview = false;
    }
  }

  private async flushDetailBatch() {
    // Prevent concurrent flushes
    if (this._flushingDetail) {
      return;
    }
    this._flushingDetail = true;

    try {
      const updates = { ...this._pendingDetailUpdates };
      this._pendingDetailUpdates = {};

      if (Object.keys(updates).length === 0) {
        // Nothing to flush
        return;
      }

      await logsContent.writeDetails(
        this._database,
        this.requireLogDir(),
        updates
      );
      this._throttledUpdateDbStats();
    } finally {
      this._flushingDetail = false;
    }
  }

  private async updateDbStats() {
    if (!this._database || !this._applicationContext) return;

    await Promise.all([
      this._database.countRows("logs"),
      this._database.countRows("logPreviews"),
      this._database.countRows("logDetails"),
    ])
      .then(([logCount, previewCount, detailsCount]) => {
        this._applicationContext?.setDbStats({
          logCount,
          previewCount,
          detailsCount,
        });
      })
      .catch(() => {});
  }

  public async startReplication(
    database: DatabaseService,
    api: ClientAPI,
    logDir: string,
    context: ApplicationContext
  ) {
    this._database = database;
    this._api = api;
    this._dir = logDir;
    this._applicationContext = context;

    // Preload cached data so the UI can render immediately while
    // sync() confirms what still exists on the server. We only push
    // data into the cache here — no fetches for missing data, since
    // those handles haven't been validated yet. These are cache-only seeds
    // from already-persisted rows, so they bypass the IndexedDB write seam.
    const logHandles = await database.readLogs();
    if (logHandles) {
      logsContent.setHandles(logDir, logHandles);

      const logPreviews = await database.readLogPreviews(logHandles);
      if (logPreviews && Object.keys(logPreviews).length > 0) {
        logsContent.mergePreviews(logDir, logPreviews);
      }

      const logDetails = await database.readLogDetails(logHandles);
      if (logDetails && Object.keys(logDetails).length > 0) {
        logsContent.mergeDetails(logDir, logDetails);
      }
      await this.updateDbStats();
    }
  }

  public stopReplication() {
    this._database = undefined;
    this._api = undefined;
    this._dir = undefined;
    this._applicationContext = undefined;
  }

  public isReplicating(): boolean {
    return !!this._api && !!this._database && !!this._applicationContext;
  }

  public async sync(progress?: boolean): Promise<LogHandle[]> {
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
      return this.sync(progress);
    }

    // No sync running, execute immediately
    this._pendingSync = this._syncImpl(progress);

    try {
      return await this._pendingSync;
    } finally {
      this._pendingSync = null;
    }
  }

  private async _syncImpl(_progress?: boolean): Promise<LogHandle[]> {
    if (!this._database) {
      throw new Error("No database available for replication.");
    }

    if (!this._api) {
      throw new Error("No API available for replication.");
    }

    if (!this._applicationContext) {
      throw new Error("No replication context available for replication.");
    }

    // First query the list of logs
    const logFiles = (await this._database.readLogs()) || [];
    let mtime = 0;
    let clientFileCount = 0;
    if (logFiles && logFiles.length > 0) {
      mtime = Math.max(...logFiles.map((file) => file.mtime || 0));
      clientFileCount = logFiles.length;
    }

    // If there are logFiles, but no mtime, then no sync is possible
    // this is just a static list.
    const staticList = logFiles.length > 0 && mtime === 0;
    if (staticList) {
      // There is no mtime data which means sync isn't possible
      // check to ensure the file list hasn't changed (in which
      // we will invlidate the whole thing)
      const serverLogs = await this._api.get_logs(0, 0);
      let invalidate = false;
      if (serverLogs.files.length !== logFiles.length) {
        // Quick check - if they're differing lengths, invalidate.
        invalidate = true;
      } else {
        // Slower check - see if _any_ files are different
        const localLogNames = new Set(logFiles.map((f) => f.name));
        for (const serverLog of serverLogs.files) {
          if (!localLogNames.has(serverLog.name)) {
            invalidate = true;
            break;
          }
        }
      }

      if (invalidate) {
        // Invalidate everything
        for (const file of logFiles) {
          void logsContent.clearFile(
            this._database,
            this.requireLogDir(),
            file.name
          );
        }

        // Drop stale queued work before scheduling new fetches
        this._previewQueue.clear();
        this._detailQueue.clear();

        // Apply the new list
        logsContent.setHandles(this.requireLogDir(), serverLogs.files);

        // Schedule sync of missing previews or details
        this.queueLogDetails(serverLogs.files);
        this.queueLogPreviews(serverLogs.files);

        return serverLogs.files;
      } else {
        // Activate the current log handles
        logsContent.setHandles(this.requireLogDir(), logFiles);

        await this.queueMissingOrStartedPreviews(logFiles);

        const detailTasks: LogHandle[] = [];
        const details = await this._database.findMissingDetails(logFiles);
        for (const d of details) {
          if (!detailTasks.find((t) => t.name === d.name)) {
            detailTasks.push(d);
          }
        }
        this.queueLogDetails(detailTasks);

        return logFiles;
      }
    }

    // Fetch the updated list of logs from the server
    const response = await this._api.get_logs(mtime, clientFileCount);
    const updatedLogs = response.files;

    if (response.response_type === "full") {
      const deletedFiles = logFiles.filter((current) => {
        return !updatedLogs.find((f) => f.name === current.name);
      });
      for (const file of deletedFiles) {
        void logsContent.clearFile(
          this._database,
          this.requireLogDir(),
          file.name
        );
      }

      if (deletedFiles.length > 0) {
        const deletedNames = deletedFiles.map((f) => f.name);
        this._previewQueue.removeByIds(deletedNames);
        this._detailQueue.removeByIds(deletedNames);
      }
    }

    // Make a list of the files in current files that are missing
    // from the files we just loaded or which have a lower mtime
    // than the file in the files list.
    const toInvalidate = updatedLogs.filter((remoteLog) => {
      const localCopy = logFiles.find((f) => f.name === remoteLog.name);

      // There isn't a local copy, so it's new
      if (!localCopy) {
        return true;
      }

      // If there is a local copy, but the remote mtime is newer, invalidate
      if (remoteLog.mtime && localCopy.mtime) {
        return remoteLog.mtime > localCopy.mtime;
      }

      // times are missing, so assume it's changed
      return true;
    });

    // Invalidate summaries and overviews for deleted or updated files
    void toInvalidate
      .map((file) => file.name)
      .map((name) =>
        logsContent.clearFile(this._database, this.requireLogDir(), name)
      );

    // Persist the current list of files and cache the full re-read.
    const allLogHandles = await logsContent.writeHandles(
      this._database,
      this.requireLogDir(),
      updatedLogs
    );

    await this.queueMissingOrStartedPreviews(allLogHandles, toInvalidate);

    // Schedule detail fetching for new/changed logs
    const detailTasks = [...toInvalidate];
    const details = await this._database.findMissingDetails(allLogHandles);
    for (const d of details) {
      if (!detailTasks.find((t) => t.name === d.name)) {
        detailTasks.push(d);
      }
    }
    this.queueLogDetails(detailTasks, WorkPriority.High);

    return allLogHandles;
  }

  public async loadLogPreviews(context: {
    logs?: LogHandle[];
    force?: boolean;
  }) {
    if (context.force) {
      const toLoad = context.logs || (await this._database?.readLogs()) || [];
      await this._previewQueue.processImmediate(toLoad);
    } else {
      const allLogs = (await this._database?.readLogs()) || [];
      const loaded = (await this._database?.readLogPreviews(allLogs)) || {};

      const logList = context.logs || allLogs;
      const filtered = logList.filter((log) => {
        const loadedPreview = loaded[log.name];
        if (!loadedPreview) {
          return true;
        }

        if (loadedPreview.status === "success") {
          return false;
        }
        return true;
      });

      // Activate existing previews (cache-only seed from persisted rows)
      if (Object.keys(loaded).length > 0) {
        logsContent.mergePreviews(this.requireLogDir(), loaded);
      }

      // Queue any missing previews
      if (filtered.length > 0) {
        this.queueLogPreviews(filtered, WorkPriority.High);
      }
    }
  }

  public clearData() {
    void logsContent.clearAll(this._database, this.requireLogDir());
    void this.updateDbStats();
  }

  private async queueMissingOrStartedPreviews(
    logHandles: LogHandle[],
    extraHandles: LogHandle[] = [],
    priority: WorkPriority = WorkPriority.High
  ) {
    if (!this._database) return;

    const tasks = [...extraHandles];
    const seen = new Set(tasks.map((t) => t.name));

    const missing = await this._database.findMissingPreviews(logHandles);
    for (const m of missing) {
      if (!seen.has(m.name)) {
        seen.add(m.name);
        tasks.push(m);
      }
    }

    const cached = await this._database.readLogPreviews(logHandles);
    for (const handle of logHandles) {
      if (seen.has(handle.name)) continue;
      const preview = cached[handle.name];
      if (preview?.status === "started") {
        seen.add(handle.name);
        await logsContent.clearPreview(
          this._database,
          this.requireLogDir(),
          handle.name
        );
        tasks.push(handle);
      }
    }

    if (tasks.length > 0) {
      this.queueLogPreviews(tasks.slice(0, 25), priority);
      this.queueLogPreviews(tasks.slice(25), WorkPriority.Medium);
    }
  }

  queueLogPreviews(
    logs: LogHandle[],
    priority: WorkPriority = WorkPriority.Medium
  ) {
    this._previewQueue.enqueue(logs, priority);
  }

  private count = 0;
  queueLogDetails(
    logs: LogHandle[],
    priority: WorkPriority = WorkPriority.Medium
  ) {
    this.count = this.count + logs.length;
    // Add to queue (deduplicated by name)
    this._detailQueue.enqueue(logs, priority);
  }
}

/**
 * Shared ReplicationService singleton. It's a server-replication helper, not
 * client state, so it lives as a module singleton (like `queryClient`) rather
 * than in the zustand store. Born inert; `startReplication(db, api, context)`
 * injects its dependencies.
 */
export const replicationService = new ReplicationService();
