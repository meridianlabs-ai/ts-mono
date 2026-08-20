import type { Event } from "@tsmono/inspect-common/types";

import { storeEventHasDefaultVisiblePreview } from "./state/StateEventRenderers";
import { kDefaultExcludeEvents } from "./types";

/**
 * The Default event-filter exclusions for a transcript, computed from its
 * events: an event type is not excluded when one of its instances has a
 * default-visible rich renderer (e.g. a human-baseline terminal session in
 * a store event), so marquee content renders without hunting through filter
 * toggles. The default is dynamic; an explicit user selection always wins.
 */
export const dynamicDefaultExcludeEvents = (
  events: readonly Event[] | undefined
): string[] => {
  const showStore = events?.some(
    (event) =>
      event.event === "store" &&
      storeEventHasDefaultVisiblePreview(event.changes)
  );
  return showStore
    ? kDefaultExcludeEvents.filter((type) => type !== "store")
    : [...kDefaultExcludeEvents];
};
