import { LogFilesResponse, LogHandle } from "@tsmono/inspect-common";
import { throttle } from "@tsmono/util";

import { ClientAPI, LogDetails, LogPreview } from "../../client/api/types";
import { DatabaseService } from "../../client/database";
import { WorkPriority, WorkQueue } from "../../utils/workQueue";

import { computeInvalidations } from "./syncCursor";

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
    this._throttledUpdateDbStats = throttle(() => this.updateDbStats(), 1000);
    this._throttledFlushPreviewBatch = throttle(
      () => this.flushPreviewBatch(),
      250
    );
    this._throttledFlushDetailBatch = throttle(
      () => this.flushDetailBatch(),
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
      onComplete: async (previews: LogPreview[], inputs: LogHandle[]) => {
        // Add to pending batch
        inputs.forEach((log, i) => {
          if (previews[i]) {
            this._pendingPreviewUpdates[log.name] = previews[i];
          }
        });

        // Schedule batched update
        this._throttledFlushPreviewBatch();
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
      onComplete: async (details: LogDetails[], inputs: LogHandle[]) => {
        // Add to pending batch
        inputs.forEach((log, i) => {
          if (details[i]) {
            this._pendingDetailUpdates[log.name] = details[i];
          }
        });

        // Schedule batched update
        this._throttledFlushDetailBatch();
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

  // Apply a server listing fetched by the caller (the useLogListing hook).
  // Owns diffing, cache invalidation, persisting the handle list, and queueing
  // preview/detail work. Returns the merged handle list now in the database.
  public async applyServerListing(
    response: LogFilesResponse,
    logFiles: LogHandle[]
  ): Promise<LogHandle[]> {
    if (!this._database) {
      throw new Error("No database available for replication.");
    }
    if (!this._applicationContext) {
      throw new Error("No replication context available.");
    }

    const updatedLogs = response.files;

    if (response.response_type === "full") {
      const deletedFiles = logFiles.filter(
        (current) => !updatedLogs.find((f) => f.name === current.name)
      );
      for (const file of deletedFiles) {
        this._database?.clearCacheForFile(file.name);
      }
      if (deletedFiles.length > 0) {
        const deletedNames = deletedFiles.map((f) => f.name);
        this._previewQueue.removeByIds(deletedNames);
        this._detailQueue.removeByIds(deletedNames);
      }
    }

    const toInvalidate = computeInvalidations(updatedLogs, logFiles);
    toInvalidate
      .map((file) => file.name)
      .map((name) => this._database?.clearCacheForFile(name));

    await this._database.writeLogs(updatedLogs);

    const allLogHandles = (await this._database.readLogs()) || [];
    this._applicationContext?.setLogHandles(allLogHandles);

    await this.queueMissingOrStartedPreviews(allLogHandles, toInvalidate);

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

  // Warm-reentry preload; the useLogListing hook owns the server fetch.
  public async preloadFromCache(): Promise<LogHandle[]> {
    if (!this._database || !this._applicationContext) return [];
    const logFiles = (await this._database.readLogs()) || [];
    this._applicationContext.setLogHandles(logFiles);
    await this.queueMissingOrStartedPreviews(logFiles);
    return logFiles;
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
    this._database?.clearAllCaches();
    this.updateDbStats();
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

  queueLogDetails(
    logs: LogHandle[],
    priority: WorkPriority = WorkPriority.Medium
  ) {
    // Add to queue (deduplicated by name)
    this._detailQueue.enqueue(logs, priority);
  }
}
