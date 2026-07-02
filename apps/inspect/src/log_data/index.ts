// Public surface of the log-data acquisition subsystem (see
// design/migration/domain-ownership.md). Everything not exported here is
// subsystem-private; external modules must import from this barrel.
export {
  cleanupDatabaseService,
  initDatabaseService,
} from "./databaseServiceInstance";
export type { LogsContentSink } from "./fetchEngine";
export { fetchEngine } from "./fetchEngine";
export {
  getLogDetail,
  mergeDetails,
  useLogDetail,
  useLogDetails,
  useLogHandles,
  useLogPreviews,
} from "./logsContent";
export {
  getPendingSamples,
  // pendingSamplesKey is test-only (runningSampleQuery.test.ts seeds the
  // cache); it leaves the barrel when that test moves in-dir.
  pendingSamplesKey,
  usePendingSamples,
} from "./pendingSamples";
export {
  deactivateReplication,
  ensureFetchEngine,
  setReplicationApi,
  syncLogPreviews,
  syncLogs,
} from "./replicationControl";
export { fetchSample, resolveSample, SampleNotFoundError } from "./sampleFetch";
export type {
  SampleEvent,
  SampleStreamSession,
  SampleStreamTick,
} from "./sampleStream";
export { createSampleStreamSession } from "./sampleStream";
export { useFetchEngineStatus } from "./useFetchEngineStatus";
export { useLogsSync } from "./useLogsSync";
