/**
 * Stable empty object reference to avoid unnecessary re-renders.
 * Use as a default value when a nullable object prop needs a fallback.
 */
export const STABLE_EMPTY_OBJECT: Record<string, never> = {};
