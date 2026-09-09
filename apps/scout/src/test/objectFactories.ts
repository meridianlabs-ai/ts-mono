import type { ScanResultData } from "../app/types";
import type { ActiveScanInfo } from "../types/api-types";

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
