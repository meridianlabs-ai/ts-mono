/** ISO timestamp → epoch seconds (the timeline/connection-history unit). */
export const isoToEpoch = (iso?: string | null): number | undefined => {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms / 1000 : undefined;
};
