/**
 * Pure fit-to-width layout for DataGrid columns, kept free of React/DOM so
 * the distribution rules are unit-testable (same split as columnReorder.ts).
 *
 * Replicates the AG grid layouts this DataGrid replaced:
 * - columns with `flex` absorb the leftover width proportionally to their
 *   weight (AG `initialFlex` — the samples grid's text columns);
 * - with no flex columns visible, every resizable column scales
 *   proportionally from its declared size to fill the width (AG
 *   `autoSizeStrategy: fitGridWidth` — the log list).
 *
 * User-resized widths (`overrides`) always win and never redistribute; when
 * minimum widths can't fit, columns floor at `minSize` and the grid scrolls
 * horizontally.
 */

export interface FitColumn {
  id: string;
  size?: number;
  minSize?: number;
  maxSize?: number;
  /** Flex weight; when set the column absorbs leftover width. */
  flex?: number;
  /** false ⇒ never scaled (mirrors `enableResizing: false`). */
  resizable?: boolean;
}

const kDefaultWidth = 150;

const baseWidth = (c: FitColumn): number =>
  c.size ?? c.minSize ?? kDefaultWidth;
const lo = (c: FitColumn): number => c.minSize ?? 20;
const hi = (c: FitColumn): number => c.maxSize ?? Infinity;
const clampWidth = (w: number, c: FitColumn): number =>
  Math.min(Math.max(w, lo(c)), hi(c));

/**
 * Resolve the width of every visible column for the given available width.
 * `availableWidth <= 0` means "not measured yet" — base sizes pass through
 * so the first paint has sane widths until the container reports in.
 */
export function resolveColumnWidths(
  columns: readonly FitColumn[],
  availableWidth: number,
  overrides: Readonly<Record<string, number>>
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const c of columns) {
    widths[c.id] = overrides[c.id] ?? baseWidth(c);
  }
  if (availableWidth <= 0) return widths;

  const isFitted = (c: FitColumn): boolean => overrides[c.id] === undefined;
  const flexCols = columns.filter((c) => (c.flex ?? 0) > 0 && isFitted(c));
  const fitted =
    flexCols.length > 0
      ? flexCols
      : columns.filter((c) => isFitted(c) && c.resizable !== false);
  if (fitted.length === 0) return widths;

  const fittedSet = new Set(fitted);
  const fixedTotal = columns.reduce(
    (sum, c) => (fittedSet.has(c) ? sum : sum + widths[c.id]!),
    0
  );
  const weightOf =
    flexCols.length > 0
      ? (c: FitColumn) => c.flex ?? 0
      : (c: FitColumn) => baseWidth(c);
  distribute(fitted, availableWidth - fixedTotal, weightOf, widths);
  return widths;
}

/** Split `target` px across `cols` proportionally to weight, clamping to
 *  each column's min/max and redistributing what clamping frees up. Widths
 *  land in `out` as integers whose total never exceeds `target` (except
 *  when the minimums alone overflow it — then the grid scrolls). */
function distribute(
  cols: readonly FitColumn[],
  target: number,
  weightOf: (c: FitColumn) => number,
  out: Record<string, number>
): void {
  const exact = new Map<string, number>();
  const minTotal = cols.reduce((sum, c) => sum + lo(c), 0);
  if (target <= minTotal) {
    for (const c of cols) out[c.id] = lo(c);
    return;
  }

  let active = [...cols];
  let remaining = target;
  while (active.length > 0) {
    const weightSum = active.reduce((sum, c) => sum + weightOf(c), 0);
    if (weightSum <= 0) {
      for (const c of active) exact.set(c.id, lo(c));
      break;
    }
    const clamped: FitColumn[] = [];
    for (const c of active) {
      const ideal = (remaining * weightOf(c)) / weightSum;
      const width = clampWidth(ideal, c);
      exact.set(c.id, width);
      if (width !== ideal) clamped.push(c);
    }
    // No clamping (or nothing left to rebalance against): shares are final.
    if (clamped.length === 0 || clamped.length === active.length) break;
    for (const c of clamped) remaining -= exact.get(c.id)!;
    const clampedSet = new Set(clamped);
    active = active.filter((c) => !clampedSet.has(c));
  }

  // Integers: floor the exact shares, then hand the lost pixels back (where
  // the max allows) so the total lands flush against the target instead of
  // a few px short.
  let sum = 0;
  for (const c of cols) {
    const w = Math.floor(exact.get(c.id)!);
    out[c.id] = w;
    sum += w;
  }
  let spare = Math.floor(target) - sum;
  for (const c of cols) {
    if (spare <= 0) break;
    if (out[c.id]! + 1 <= hi(c)) {
      out[c.id]! += 1;
      spare -= 1;
    }
  }
}
