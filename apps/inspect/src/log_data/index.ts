// Public surface of the log-data acquisition subsystem (see
// design/migration/domain-ownership.md): data hooks plus the single
// imperative entry-point object. Everything not exported here is
// subsystem-private; external modules must import from this barrel.
//
// ---------------------------------------------------------------------------
// Ubiquitous language — every term the exported symbols reference, defined
// once. Use these words exactly; "avoid" names synonyms that cause drift.
//
// Identity (how things are addressed — always explicit params, never ambient)
// - log dir       The directory of eval logs a session browses; the coarsest
//                 identity and the first parameter of every hook.
// - log file      One eval log inside a log dir, identified by name.
// - LogHandle     A log file's identity row in the listing: name + mtime.
//                 Carries no content.
// - SampleHandle  One sample's identity within a log: id + epoch + logFile.
//
// Log content (the same log file, at increasing depth)
// - listing       The set of LogHandles currently known for a log dir.
// - LogPreview    Row-level display data for one log (status, task, model,
//                 primary metric) — enough to render a list/grid row.
// - LogDetails    The full parsed content of one log: spec, plan, results,
//                 stats, and its sample summaries. Avoid: "header" (legacy).
//
// Sample content (the same sample, at increasing depth)
// - SampleSummary The row-level record of one sample (input, target, scores,
//                 error); what sample lists render. Merged from the log's
//                 details and, while running, the live stream — one list,
//                 assembly private.
// - body          The complete EvalSample: messages, events, scores. Large;
//                 fetched on demand, cache-resident only while recently
//                 viewed.
// - SampleData    The one answer to "show this sample": body + status +
//                 still-streaming events. Which path serves it (completed
//                 fetch, error-summary fallback, live stream, finalize
//                 handoff) is private.
// - running       Describes an eval still executing: its summaries, metrics
//                 (RunningMetric), and sample events tick live until it
//                 completes. Avoid: "pending" (wire-format word).
//
// Freshness (how data stays current)
// - sync          The listing discovery pass: diff the server's listing
//                 against the known one, re-acquire what changed.
//                 Subscriber-driven: mounting useLogsSync is what keeps a
//                 dir fresh; its `scope` keys a panel's subscription so
//                 navigating re-syncs. ListingStatus (busy, error) is its
//                 one progress signal.
// - invalidate    Mark a query stale so mounted subscribers re-fetch.
//                 Fire-and-forget: consequences are observed through the
//                 hooks, never awaited. Both imperative freshness verbs are
//                 invalidations — invalidateLogDetail (one log's details),
//                 invalidateLogListing (the listing).
// - passive read  Subscribe to cached data without ever fetching
//                 (usePassiveEvalSample); absence is a normal answer, not a
//                 loading state.
// - clear         Destroy the local replica — IndexedDB and the cached
//                 collections — then request a listing re-sync so mounted
//                 panels re-acquire. DbStats (useDatabaseStats) counts what
//                 the replica holds.
//
// Relationships
// - A log dir has one listing; a listing has many LogHandles.
// - LogHandle → LogPreview → LogDetails: one log file at increasing depth;
//   LogDetails owns the log's SampleSummaries.
// - SampleSummary → body: one sample at increasing depth; a body may be
//   absent (never viewed, or evicted) while its summary is always present.
// ---------------------------------------------------------------------------
export { imperativeLogData } from "./imperativeLogData";
export { useLogDetailQuery } from "./logDetailQuery";
export {
  useLogDetail,
  useLogDetails,
  useLogHandles,
  useLogPreviews,
} from "./logsContent";
export { useRunningMetrics } from "./pendingSamples";
export { type SampleData, useSampleData } from "./sampleData";
export { useSampleSummaries } from "./sampleSummaries";
export { usePassiveEvalSample } from "./sampleQuery";
export { useDatabaseStats } from "./useFetchEngineStatus";
export { useLogsSync } from "./useLogsSync";
