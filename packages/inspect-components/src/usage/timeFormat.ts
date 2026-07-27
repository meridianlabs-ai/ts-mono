export const fmtCompactDuration = (s: number): string => {
  // Round at the display grain up front — rounding a remainder alone
  // carries badly ("1m 60s" for 119.6).
  const t = Math.round(s);
  if (t < 60) return `${t}s`;
  if (t < 3600) {
    const m = Math.floor(t / 60);
    const r = t % 60;
    return r > 0 ? `${m}m ${r}s` : `${m}m`;
  }
  if (t < 86400) {
    const totalM = Math.round(t / 60);
    const h = Math.floor(totalM / 60);
    const m = totalM % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const totalH = Math.round(t / 3600);
  const d = Math.floor(totalH / 24);
  const h = totalH % 24;
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
};

/** "Jul 5 14:03:22" from epoch seconds — 24h so the mono time columns stay
 *  fixed width; one rendering for the connection/config event stream
 *  (Connection Log modal and the Timeline History list). */
export const fmtDayClock = (epochSec: number): string => {
  const d = new Date(epochSec * 1000);
  const day = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${day} ${d.toLocaleTimeString(undefined, { hour12: false })}`;
};

export const fmtClock = (iso?: string | null, showDate = false): string => {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const time = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
    if (!showDate) return time;
    const date = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${date}, ${time}`;
  } catch {
    return iso;
  }
};
