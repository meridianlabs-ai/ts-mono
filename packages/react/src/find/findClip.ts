/** Whether `range` sits below a collapsed clip of height `foldPx`. */
export function rangeExceedsFold(
  clip: Element,
  range: Range,
  foldPx: number
): boolean {
  if (typeof range.getClientRects !== "function") return false;
  const box = range.getClientRects()[0];
  if (box === undefined) return false;
  // Same 1px as overflow: sub-pixel boxes sitting on the fold line stay
  // inside. Compare against clip.top + foldPx, not live clip.height, so an
  // already-expanded panel can still decide to collapse.
  return box.bottom > clip.getBoundingClientRect().top + foldPx + 1;
}
