/**
 * Compute the maximum label length from a label map.
 * Hoisted out of ChatMessageRow so it runs once per message list,
 * not once per row (O(n) vs O(n²)).
 */
export function computeMaxLabelLength(
  messageLabels: Record<string, string> | undefined
): number {
  if (!messageLabels) return 3;
  let max = 0;
  for (const v of Object.values(messageLabels)) {
    if (v.length > max) max = v.length;
  }
  return max;
}
