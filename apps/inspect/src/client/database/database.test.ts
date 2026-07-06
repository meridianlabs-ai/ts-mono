/**
 * Automated tests for database functionality
 * Uses fake-indexeddb for testing IndexedDB operations in Vitest
 *
 * Schema v3 structure:
 * - logs: stores results from get_log_files() (LogHandles)
 * - log_previews: stores results from get_log_summaries() (LogPreviews)
 * - log_details: stores complete results from get_log_info() including samples (LogDetails)
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { LogHandle } from "@tsmono/inspect-common";

import { LogDetails, LogPreview, SampleSummary } from "../api/types";

import { LogFetchStateRecord } from "./schema";
import { createDatabaseService, DatabaseService } from "./service";

// Helper function to create test LogSummary
function createTestLogSummary(overrides: Partial<LogPreview> = {}): LogPreview {
  return {
    eval_id: "eval-1",
    run_id: "run-1",
    task: "test-task",
    task_id: "task-1",
    task_version: 1,
    version: 1,
    status: "success",
    error: null,
    model: "gpt-4",
    started_at: "2024-01-01T00:00:00Z",
    completed_at: "2024-01-01T01:00:00Z",
    ...overrides,
  };
}

// Helper function to create test LogInfo
function createTestLogInfo(overrides: Partial<LogDetails> = {}): LogDetails {
  return {
    version: 1,
    status: "success",
    eval: {
      eval_set_id: "set-1",
      eval_id: "eval-1",
      run_id: "run-1",
      created: "2024-01-01T00:00:00Z",
      task: "test-task",
      task_id: "task-1",
      task_version: 1,
      task_file: "test.py",
      task_display_name: "Test Task",
      task_registry_name: "test",
      task_attribs: {},
      task_args: {},
      task_args_passed: {},
      solver: null,
      solver_args: {},
      tags: [],
      dataset: {
        name: "test-dataset",
        location: "/test/dataset",
        samples: 10,
        sample_ids: ["1", "2", "3"],
        shuffled: false,
      },
      sandbox: null,
      model: "gpt-4",
      model_generate_config: {},
      model_base_url: null,
    } as unknown as LogDetails["eval"],
    plan: undefined,
    results: null,
    stats: undefined,
    error: null,
    sampleSummaries: [],
    ...overrides,
  };
}

// Helper function to create test SampleSummary
function createTestSampleSummary(
  overrides: Partial<SampleSummary> = {}
): SampleSummary {
  return {
    id: 1,
    epoch: 0,
    input: "test input",
    target: "test target",
    scores: {
      accuracy: {
        value: 0.9,
        answer: null,
        explanation: null,
        metadata: {},
        history: [],
      },
    },
    completed: true,
    ...overrides,
  };
}

describe("Database Service", () => {
  let databaseService: DatabaseService;

  beforeEach(async () => {
    // Create a new database service for each test
    databaseService = createDatabaseService();
    // Open database with test log directory
    await databaseService.openDatabase("/test/logs");
  });

  afterEach(async () => {
    // Clean up after each test (only if database is still open)
    try {
      await databaseService.clearAllCaches();
      await databaseService.closeDatabase();
    } catch {
      // Database might already be closed in error handling tests
    }
  });

  describe("Log Files Caching", () => {
    test("should cache and retrieve log files", async () => {
      const testLogRoot: LogHandle[] = [
        {
          name: "/test/logs/eval1.json",

          task: "test-task-1",
          task_id: "task1",
        },
        {
          name: "/test/logs/eval2.json",

          task: "test-task-2",
          task_id: "task2",
        },
      ];

      // Cache the log files
      await databaseService.writeLogs(testLogRoot);

      // Retrieve cached files
      const files = await databaseService.readLogs();

      expect(files).not.toBeNull();
      expect(files).toHaveLength(2);
      expect(files?.[0]?.name).toBe("/test/logs/eval1.json");
      expect(files?.[0]?.task).toBe("test-task-1");
    });

    test("should update existing cached log files", async () => {
      const initialFiles: LogHandle[] = [
        { name: "/test/logs/eval1.json", task: "initial-task" },
      ];
      await databaseService.writeLogs(initialFiles);

      // Update with new data
      const updatedFiles: LogHandle[] = [
        { name: "/test/logs/eval1.json", task: "updated-task" },
        { name: "/test/logs/eval2.json", task: "additional-task" },
      ];
      await databaseService.writeLogs(updatedFiles);
      const files = await databaseService.readLogs();
      expect(files).toHaveLength(2);
      expect(files?.find((f) => f.name === "/test/logs/eval1.json")?.task).toBe(
        "updated-task"
      );
      expect(files?.find((f) => f.name === "/test/logs/eval2.json")?.task).toBe(
        "additional-task"
      );
    });
  });

  describe("Log Summaries Caching", () => {
    test("should cache and retrieve log summaries", async () => {
      const summaries = [
        createTestLogSummary({ eval_id: "eval-1", task: "task-1" }),
        createTestLogSummary({ eval_id: "eval-2", task: "task-2" }),
      ];
      const logHandles: LogHandle[] = [
        { name: "/test/logs/eval1.json" },
        { name: "/test/logs/eval2.json" },
      ];

      // Cache the summaries
      await databaseService.writeLogPreviews(
        summaries,
        logHandles.map((logHandle) => logHandle.name)
      );

      // Retrieve cached summaries
      const cached = await databaseService.readLogPreviews(logHandles);

      expect(Object.keys(cached)).toHaveLength(2);
      expect(cached["/test/logs/eval1.json"]).toBeDefined();
      expect(cached["/test/logs/eval1.json"]?.eval_id).toBe("eval-1");
      expect(cached["/test/logs/eval2.json"]?.task).toBe("task-2");
    });

    test("should handle partial cache hits", async () => {
      const summary = createTestLogSummary({ eval_id: "eval-1" });

      // Cache only one summary
      await databaseService.writeLogPreviews(
        [summary],
        ["/test/logs/eval1.json"]
      );

      // Request multiple summaries
      const cached = await databaseService.readLogPreviews([
        { name: "/test/logs/eval1.json" },
        { name: "/test/logs/eval2.json" },
        { name: "/test/logs/eval3.json" },
      ]);

      // Should only return the cached one
      expect(Object.keys(cached)).toHaveLength(1);
      expect(cached["/test/logs/eval1.json"]).toBeDefined();
      expect(cached["/test/logs/eval2.json"]).toBeUndefined();
    });
  });

  describe("Log Info Caching", () => {
    test("should cache and retrieve log info with samples", async () => {
      const samples = [
        createTestSampleSummary({ id: 1 }),
        createTestSampleSummary({
          id: 2,
          scores: {
            accuracy: {
              value: 0.85,
              answer: null,
              explanation: null,
              metadata: {},
              history: [],
            },
          },
        }),
      ];

      const logInfo = createTestLogInfo({
        sampleSummaries: samples,
      });

      // Ingest the payload (split: header row + summary rows)
      await databaseService.writeLogDetails({
        "/test/logs/eval1.json": logInfo,
      });

      // Retrieve the stored header
      const cached = await databaseService.readLogDetailsForFile(
        "/test/logs/eval1.json"
      );

      expect(cached).not.toBeNull();
      expect(cached?.eval.eval_id).toBe("eval-1");
      expect(cached).not.toHaveProperty("sampleSummaries");
      expect(cached?.sampleCount).toBe(2);

      const rows = await databaseService.readSampleSummaries({
        file: "/test/logs/eval1.json",
      });
      expect(rows).toHaveLength(2);
      expect(rows[0]?.summary.id).toBe(1);
    });

    test("should return null for non-cached log info", async () => {
      const cached = await databaseService.readLogDetailsForFile(
        "/test/logs/nonexistent.json"
      );
      expect(cached).toBeNull();
    });

    test("findMissingDetails treats details cached as started as missing", async () => {
      // A "started" details row is a mid-run snapshot — the run may have
      // finished since, so backfill must re-fetch it.
      await databaseService.writeLogDetails({
        "/test/logs/running.json": createTestLogInfo({ status: "started" }),
        "/test/logs/done.json": createTestLogInfo({ status: "success" }),
      });

      const missing = await databaseService.findMissingDetails([
        { name: "/test/logs/running.json" },
        { name: "/test/logs/done.json" },
        { name: "/test/logs/absent.json" },
      ]);

      expect(missing.map((log) => log.name).sort()).toEqual([
        "/test/logs/absent.json",
        "/test/logs/running.json",
      ]);
    });
  });

  describe("Sample Summaries Store", () => {
    test("should split sample summaries into their own rows at ingestion", async () => {
      const samples = [
        createTestSampleSummary({ id: 1, completed: true }),
        createTestSampleSummary({ id: 2, completed: false }),
        createTestSampleSummary({ id: 3, error: "timeout" }),
      ];

      await databaseService.writeLogDetails({
        "/test/logs/eval1.json": createTestLogInfo({
          sampleSummaries: samples,
        }),
      });

      const rows = await databaseService.readSampleSummaries({
        file: "/test/logs/eval1.json",
      });

      expect(rows).toHaveLength(3);
      expect(rows[0]?.summary.id).toBe(1);
      expect(rows[1]?.summary.completed).toBe(false);
      expect(rows[2]?.summary.error).toBe("timeout");
    });

    test("should return empty array for file without cached info", async () => {
      const rows = await databaseService.readSampleSummaries({
        file: "/test/logs/nonexistent.json",
      });
      expect(rows).toEqual([]);
    });

    test("should read sample summaries across files by prefix", async () => {
      await databaseService.writeLogDetails({
        "/test/logs/eval1.json": createTestLogInfo({
          sampleSummaries: [
            createTestSampleSummary({ id: 1 }),
            createTestSampleSummary({ id: 2 }),
          ],
        }),
        "/test/logs/sub/eval2.json": createTestLogInfo({
          sampleSummaries: [createTestSampleSummary({ id: 3 })],
        }),
      });

      const all = await databaseService.readSampleSummaries({
        prefix: "/test/logs/",
      });
      expect(all).toHaveLength(3);

      const sub = await databaseService.readSampleSummaries({
        prefix: "/test/logs/sub",
      });
      expect(sub).toHaveLength(1);
      expect(sub[0]?.summary.id).toBe(3);
    });

    test("re-ingestion replaces a file's summary rows", async () => {
      await databaseService.writeLogDetails({
        "/test/logs/eval1.json": createTestLogInfo({
          sampleSummaries: [
            createTestSampleSummary({ id: 1 }),
            createTestSampleSummary({ id: 2 }),
          ],
        }),
      });
      await databaseService.writeLogDetails({
        "/test/logs/eval1.json": createTestLogInfo({
          sampleSummaries: [createTestSampleSummary({ id: 1 })],
        }),
      });

      const rows = await databaseService.readSampleSummaries({
        file: "/test/logs/eval1.json",
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("Cache Statistics and Management", () => {
    test("should return cache statistics", async () => {
      const stats = await databaseService.getCacheStats();

      expect(stats.logFiles).toBe(0);
      expect(stats.logSummaries).toBe(0);
      expect(stats.sampleSummaries).toBe(0);
      expect(stats.logHandle).toBe("/test/logs");
    });

    test("should clear all caches", async () => {
      // Cache data in all tables
      await databaseService.writeLogs([
        { name: "/test/logs/eval1.json", task: "task-1", task_id: "task1" },
      ]);

      await databaseService.writeLogPreviews(
        [createTestLogSummary()],
        ["/test/logs/eval1.json"]
      );

      await databaseService.writeLogDetails({
        "/test/logs/eval1.json": createTestLogInfo({
          sampleSummaries: [createTestSampleSummary()],
        }),
      });

      const stats1 = await databaseService.getCacheStats();
      expect(stats1.logFiles).toBe(1);
      expect(stats1.logSummaries).toBe(1);
      expect(stats1.sampleSummaries).toBe(1);

      // Clear all caches
      await databaseService.clearAllCaches();

      const stats2 = await databaseService.getCacheStats();
      expect(stats2.logFiles).toBe(0);
      expect(stats2.logSummaries).toBe(0);
      expect(stats2.sampleSummaries).toBe(0);
    });

    test("should count sample summaries correctly", async () => {
      // Cache multiple log info with different number of samples
      await databaseService.writeLogDetails({
        "/test/logs/eval1.json": createTestLogInfo({
          sampleSummaries: [
            createTestSampleSummary({ id: 1 }),
            createTestSampleSummary({ id: 2 }),
          ],
        }),
        "/test/logs/eval2.json": createTestLogInfo({
          sampleSummaries: [
            createTestSampleSummary({ id: 3 }),
            createTestSampleSummary({ id: 4 }),
            createTestSampleSummary({ id: 5 }),
          ],
        }),
      });

      const stats = await databaseService.getCacheStats();
      expect(stats.sampleSummaries).toBe(5); // Total samples across both files
    });
  });

  describe("Log Fetch State Caching", () => {
    function createTestFetchState(
      overrides: Partial<LogFetchStateRecord> = {}
    ): LogFetchStateRecord {
      return {
        file_path: "/test/logs/eval1.json",
        preview_attempts: 0,
        details_attempts: 0,
        details_settled_seq: 0,
        updated_at: "2024-01-01T00:00:00Z",
        ...overrides,
      };
    }

    test("round-trips a fetch-state record", async () => {
      const state = createTestFetchState({
        file_path: "/test/logs/eval1.json",
        preview_fetch_error: "boom",
        preview_attempts: 2,
        details_fetch_error: "kaboom",
        details_attempts: 1,
        details_settled_seq: 3,
      });

      await databaseService.writeFetchStates({
        "/test/logs/eval1.json": state,
      });

      const read = await databaseService.readFetchStates();
      expect(read["/test/logs/eval1.json"]).toEqual(state);
    });

    test("writes multiple fetch-state records in one call", async () => {
      const a = createTestFetchState({ file_path: "/test/logs/a.json" });
      const b = createTestFetchState({
        file_path: "/test/logs/b.json",
        details_attempts: 5,
      });

      await databaseService.writeFetchStates({
        "/test/logs/a.json": a,
        "/test/logs/b.json": b,
      });

      const read = await databaseService.readFetchStates();
      expect(Object.keys(read).sort()).toEqual([
        "/test/logs/a.json",
        "/test/logs/b.json",
      ]);
      expect(read["/test/logs/b.json"]?.details_attempts).toBe(5);
    });

    test("clearCacheForFile deletes the fetch-state row", async () => {
      await databaseService.writeFetchStates({
        "/test/logs/eval1.json": createTestFetchState(),
      });

      await databaseService.clearCacheForFile("/test/logs/eval1.json");

      const read = await databaseService.readFetchStates();
      expect(read["/test/logs/eval1.json"]).toBeUndefined();
    });

    test("clearAllCaches deletes all fetch-state rows", async () => {
      await databaseService.writeFetchStates({
        "/test/logs/a.json": createTestFetchState({
          file_path: "/test/logs/a.json",
        }),
        "/test/logs/b.json": createTestFetchState({
          file_path: "/test/logs/b.json",
        }),
      });

      await databaseService.clearAllCaches();

      const read = await databaseService.readFetchStates();
      expect(Object.keys(read)).toHaveLength(0);
    });
  });

  describe("Error Handling", () => {
    test("should handle cache retrieval errors gracefully", async () => {
      // Close database to simulate error
      await databaseService.closeDatabase();

      // Should return null when database is closed (graceful error handling)
      const result = await databaseService.readLogs();
      expect(result).toBeNull();
    });
  });
});
