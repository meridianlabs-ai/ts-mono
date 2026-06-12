import { LogHandle } from "@tsmono/inspect-common";
import { throttle } from "@tsmono/util";

import { ClientAPI, LogDetails, LogPreview } from "../../client/api/types";
import { DatabaseService } from "../../client/database";
import { WorkPriority, WorkQueue } from "../../utils/workQueue";

export interface ApplicationContext {
  setLogHandles: (logs: LogHandle[]) => void;
  getSelectedLog: () => LogHandle | undefined;
  setSelectedLogFile: (fileName: string) => void;
  updateLogPreviews: (previews: Record<string, LogPreview>) => void;
  updateLogDetails: (details: Record<string, LogDetails>) => void;
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

      // Write to database
      if (this._database) {
        await this._database
          .writeLogPreviews(Object.values(updates), Object.keys(updates))
          .catch(() => {});
        this._throttledUpdateDbStats();
      }

      // Update store
      setTimeout(() => {
        this._applicationContext?.updateLogPreviews(updates);
      }, 0);
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

      if (this._database) {
        // Write to the database
        await this._database.writeLogDetails(updates);
        this._throttledUpdateDbStats();
      }

      setTimeout(() => {
        // Update store
        this._applicationContext?.updateLogDetails(updates);
      }, 0);
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
    context: ApplicationContext
  ) {
    this._database = database;
    this._api = api;
    this._applicationContext = context;

    // Preload cached data so the UI can render immediately while
    // sync() confirms what still exists on the server. We only push
    // data into the store here — no fetches for missing data, since
    // those handles haven't been validated yet.
    const logHandles = await database.readLogs();
    if (logHandles) {
      context.setLogHandles(logHandles);

      const logPreviews = await database.readLogPreviews(logHandles);
      if (logPreviews && Object.keys(logPreviews).length > 0) {
        context.updateLogPreviews(logPreviews);
      }

      const logDetails = await database.readLogDetails(logHandles);
      if (logDetails && Object.keys(logDetails).length > 0) {
        context.updateLogDetails(logDetails);
      }
      await this.updateDbStats();
    }
  }

  public stopReplication() {
    this._database = undefined;
    this._api = undefined;
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

  private async _syncImpl(progress?: boolean): Promise<LogHandle[]> {
    if (!this._database) {
      throw new Error("No database available for replication.");
    }

    if (!this._api) {
      throw new Error("No API available for replication.");
    }

    if (!this._applicationContext) {
      throw new Error("No replication context available for replication.");
    }

    if (progress) {
      this._applicationContext.setLoading(true);
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
          void this._database?.clearCacheForFile(file.name);
        }

        // Drop stale queued work before scheduling new fetches
        this._previewQueue.clear();
        this._detailQueue.clear();

        // Apply the new list
        this._applicationContext?.setLogHandles(serverLogs.files);

        // Schedule sync of missing previews or details
        this.queueLogDetails(serverLogs.files);
        this.queueLogPreviews(serverLogs.files);

        if (progress) {
          this._applicationContext.setLoading(false);
        }

        return serverLogs.files;
      } else {
        // Activate the current log handles
        this._applicationContext?.setLogHandles(logFiles);

        await this.queueMissingOrStartedPreviews(logFiles);

        const detailTasks: LogHandle[] = [];
        const details = await this._database.findMissingDetails(logFiles);
        for (const d of details) {
          if (!detailTasks.find((t) => t.name === d.name)) {
            detailTasks.push(d);
          }
        }
        this.queueLogDetails(detailTasks);

        if (progress) {
          this._applicationContext.setLoading(false);
        }

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
        void this._database?.clearCacheForFile(file.name);
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
      .map((name) => this._database?.clearCacheForFile(name));

    // Cache the current list of files
    await this._database.writeLogs(updatedLogs);

    // Update the log handles in the application state
    const allLogHandles = (await this._database.readLogs()) || [];
    this._applicationContext?.setLogHandles(allLogHandles);

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

    if (progress) {
      this._applicationContext.setLoading(false);
    }

    return allLogHandles;
  }

  public async loadLogPreviews(context: {
    logs?: LogHandle[];
    force?: boolean;
  }) {
    this._applicationContext?.setLoading(true);
    try {
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

        // Activate existing previews
        if (Object.keys(loaded).length > 0) {
          this._applicationContext?.updateLogPreviews(loaded);
        }

        // Queue any missing previews
        if (filtered.length > 0) {
          this.queueLogPreviews(filtered, WorkPriority.High);
        }
      }
    } finally {
      this._applicationContext?.setLoading(false);
    }
  }

  public clearData() {
    void this._database?.clearAllCaches();
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
        await this._database.clearPreviewForFile(handle.name);
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
