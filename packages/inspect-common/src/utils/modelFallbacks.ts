import type { ModelFallback } from "../types";

/**
 * Total generate calls served via fallback across a sample's rollup.
 */
export const totalModelFallbacks = (
  fallbacks?: ModelFallback[] | null
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
): number => (fallbacks ?? []).reduce((sum, f) => sum + (f.count ?? 1), 0);

/**
 * One "requested → served (×N)" line per fallback rollup entry.
 */
export const modelFallbackLines = (
  fallbacks?: ModelFallback[] | null
): string[] =>
  (fallbacks ?? []).map(
    (f) =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      `${f.model} → ${f.fallback_model}${(f.count ?? 1) > 1 ? ` (×${f.count})` : ""}`
  );
