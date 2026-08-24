/**
 * Boundary normalization for wire data (#555).
 *
 * Raw log/journal JSON is written by many inspect_ai versions: fields the
 * current generated types declare required may be absent (pydantic fills
 * them with defaults at read time on the Python side), and some shapes were
 * renamed outright. These normalizers mirror pydantic's read behavior —
 * legacy-shape migrations first, then read-time defaults — so data that has
 * passed through them genuinely satisfies the generated types and
 * downstream code needs no defensive guards.
 *
 * Every raw parse of eval-log or journal data must run through one of
 * these before the result is treated as typed.
 */
export {
  defaultModelOutput,
  normalizeEvent,
  normalizeEvents,
  normalizeModelUsage,
} from "./events";
export {
  normalizeConfigUpdates,
  normalizeEvalPlan,
  normalizeEvalResults,
  normalizeEvalSpec,
} from "./log";
export { normalizeEvalSample } from "./sample";
