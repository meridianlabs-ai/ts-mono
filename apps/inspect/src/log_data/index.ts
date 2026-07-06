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
// Log content (the same log file, at increasing depth = increasing cost;
// each tier exists because fetching the next one for every log would be too
// expensive)
// - listing       The set of log files currently known for a log dir, read
//                 as LogListingRows.
// - LogListingRow One log file's row in the listing: its handle, retried
//                 marking, and preview (absent until acquired). The one shape
//                 listing surfaces render; the handles ⋈ previews join is
//                 subsystem-private.
// - LogPreview    The cheap projection of one log (status, task, model,
//                 primary metric) — fetched first for every log in a dir, so
//                 a large directory's grid renders immediately. Surfaces as
//                 a LogListingRow's `preview`, never as its own collection.
// - log header    The full parsed header of one log: spec, plan, results,
//                 stats, plus derived sample facts (count, error count,
//                 limit kinds) — a LogListingRow's `header`, and the deep
//                 form `useLogDetail` serves. Backfilled dir-wide in the
//                 background (grid scorer columns need full results);
//                 elevated to user priority when a log is opened. The
//                 acquisition payload also carries the log's sample
//                 summaries; the sink splits those into their own store —
//                 no consumer ever sees them embedded.
//
// Sample content (the same sample, at increasing depth)
// - SampleSummary The row-level record of one sample (input, target, scores,
//                 error); what sample lists render. Belongs to a Log; lives
//                 in its own store. Merged from the settled store and, while
//                 running, the live stream — one list, assembly private.
// - samples scope Which samples a read covers: one log file (the log view's
//                 list) or a path prefix (samples mode). useSamplesListing
//                 rows carry their log's display context — consumers never
//                 join by name.
// - EvalSample    The complete sample: messages, events, scores. Large;
//                 fetched on demand, cache-resident only while recently
//                 viewed.
// - SampleData    The one answer to "show this sample": EvalSample + status +
//                 still-streaming events. Which path serves the EvalSample
//                 (completed fetch, error-summary fallback, live stream,
//                 finalize handoff) is private.
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
// - invalidate    Force a fresh read so mounted subscribers pick it up.
//                 Fire-and-forget: consequences are observed through the
//                 hooks, never awaited. Both imperative freshness verbs are
//                 invalidations — invalidateLogDetail (one log's details),
//                 invalidateLogListing (the listing).
// - passive read  Subscribe to cached data without independently inducing a
//                 fetch (usePassiveSampleData); absence is a normal answer
//                 (undefined), not a loading state.
// - clear         Destroy the local replica — IndexedDB and the cached
//                 collections — then request a listing re-sync so mounted
//                 panels re-acquire. DbStats (useDatabaseStats) counts what
//                 the replica holds.
//
// Relationships
// - A log dir has one listing; a listing has many LogListingRows, each
//   wrapping one LogHandle.
// - LogHandle → LogPreview → log header: one log file at increasing depth.
//   A Log owns its SampleSummaries (their own store, read by samples scope).
// - SampleSummary → EvalSample: one sample at increasing depth; the
//   EvalSample may be absent (never viewed, or evicted) while its summary is
//   always present.
// ---------------------------------------------------------------------------
export { imperativeLogData } from "./imperativeLogData";
export { type LogDataState, useLogDetail } from "./logDetail";
export { type LogListingRow, useLogListing } from "./logListing";
export { resolveLogKey, useLogFetchState } from "./logsContent";
export { useRunningMetrics } from "./pendingSamples";
export {
  type SampleData,
  usePassiveSampleData,
  useSampleData,
} from "./sampleData";
export {
  type SamplesListingRow,
  type SamplesScope,
  useSamplesListing,
} from "./samplesListing";
export { useSampleSummaries } from "./sampleSummaries";
export { type ScorerMap, scorerMetricKey, useScoreSchema } from "./scoreSchema";
export { useDatabaseStats } from "./useFetchEngineStatus";
export { useLogsSync } from "./useLogsSync";
