import type { ScanResultData } from "../app/types";
import type { ActiveScanInfo, AppConfig, Status } from "../types/api-types";

export function createActiveScanInfo(
  overrides: Partial<ActiveScanInfo> & { scan_id: string }
): ActiveScanInfo {
  return {
    config: "default",
    last_updated: 1704067200,
    location: `/scans/${overrides.scan_id}`,
    metrics: {
      batch_failures: 0,
      batch_pending: 0,
      buffered_scanner_jobs: 0,
      completed_scans: 0,
      memory_usage: 0,
      process_count: 0,
      task_count: 0,
      tasks_idle: 0,
      tasks_parsing: 0,
      tasks_scanning: 0,
    },
    scanner_names: [],
    start_time: 1704067200,
    summary: { complete: true, scanners: {} },
    title: overrides.scan_id,
    total_scans: 0,
    ...overrides,
  };
}

export function createScanResultData(
  overrides: Partial<ScanResultData> = {}
): ScanResultData {
  return {
    identifier: "result-1",
    inputType: "events",
    eventReferences: [],
    messageReferences: [],
    validationResult: true,
    validationTarget: null,
    value: null,
    valueType: "null",
    transcriptSourceId: "source-1",
    transcriptMetadata: {},
    inputIds: [],
    metadata: {},
    scanId: "scan-1",
    scanMetadata: {},
    scanModelUsage: {},
    scanTags: [],
    scanTotalTokens: 0,
    scannerFile: "scanner.py",
    scannerKey: "scanner",
    scannerName: "scanner",
    scannerParams: {},
    transcriptId: "transcript-1",
    transcriptSourceUri: "file:///transcript",
    ...overrides,
  };
}

export function createAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    filter: [],
    home_dir: "/home/tester",
    project_dir: "/home/tester/project",
    scans: { dir: "/home/tester/project/scans", source: "project" },
    ...overrides,
  };
}

export function createStatus(overrides: Partial<Status> = {}): Status {
  return {
    complete: false,
    errors: [],
    location: "/home/tester/project/scans/scan_id=3oUGqQCpPQ9WSNPV4oy7Fe",
    spec: {
      scan_id: "3oUGqQCpPQ9WSNPV4oy7Fe",
      scan_name: "test-scan",
      options: { max_transcripts: 25 },
      packages: {},
      scanners: {},
      timestamp: "2024-01-01T00:00:00Z",
    },
    summary: { complete: false, scanners: {} },
    ...overrides,
  };
}
