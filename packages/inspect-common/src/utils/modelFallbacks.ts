import type { ModelFallback } from "../types";

/**
 * Total requests served via fallback across a sample's rollup.
 */
export const totalModelFallbacks = (
  fallbacks?: ModelFallback[] | null
): number => (fallbacks ?? []).reduce((sum, f) => sum + f.count, 0);

/**
 * One "requested → served (×N)" line per fallback rollup entry.
 */
export const modelFallbackLines = (
  fallbacks?: ModelFallback[] | null
): string[] =>
  (fallbacks ?? []).map(
    (f) =>
      `${f.model} → ${f.fallback_model}${f.count > 1 ? ` (×${f.count})` : ""}`
  );
