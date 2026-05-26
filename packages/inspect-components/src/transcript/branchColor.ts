// Golden-angle rotation off a 210° anchor produces maximally-distinct
// neighbouring hues and never collides within the first 12 indexes.
const HUE_ANCHOR = 210;
const HUE_STEP = 137.5;

/** FNV-1a 32-bit hash. Returns an unsigned 32-bit integer. */
export function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Deterministic hue (0..360) for a branch label. Parses the trailing integer
 * (e.g. "branch 7") and rotates by the golden angle; falls back to a hash
 * of the label for non-numeric names.
 */
export function hueForBranch(name: string): number {
  const m = /(\d+)\s*$/.exec(name);
  const idx = m ? parseInt(m[1]!, 10) - 1 : hash32(name) % 12;
  return (HUE_ANCHOR + idx * HUE_STEP) % 360;
}
