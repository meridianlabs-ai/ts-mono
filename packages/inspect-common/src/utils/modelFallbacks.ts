import type { ModelFallback } from "../types";

// The generated type declares `count: number` (schema default 1), but logs
// serialized without defaulted fields can omit it, so widen before reading.
const fallbackCount = (f: ModelFallback): number =>
  (f.count as number | undefined) ?? 1;

/**
 * Total generate calls served via fallback across a sample's rollup.
 */
export const totalModelFallbacks = (
  fallbacks?: ModelFallback[] | null
): number => (fallbacks ?? []).reduce((sum, f) => sum + fallbackCount(f), 0);

/**
 * One "requested → served (×N)" line per fallback rollup entry.
 */
export const modelFallbackLines = (
  fallbacks?: ModelFallback[] | null
): string[] =>
  (fallbacks ?? []).map(
    (f) =>
      `${f.model} → ${f.fallback_model}${fallbackCount(f) > 1 ? ` (×${f.count})` : ""}`
  );
