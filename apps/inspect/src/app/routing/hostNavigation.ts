import type { WebviewStorage } from "@tsmono/util";

import type { UpdateStateMessage } from "../../client/api/types";

type Destination = UpdateStateMessage["data"];
const key = "inspect-host-destination-v1";
const identity = (message: Destination) =>
  JSON.stringify([message.url, message.sample_id, message.sample_epoch]);

/** Inspect View replays its last command on focus; it is not a new navigation. */
export function createHostCommandFilter(
  storage: WebviewStorage | undefined,
  initial: Destination | null
): (message: Destination) => boolean {
  let previous = storage?.getItem(key) ?? (initial ? identity(initial) : null);
  return (message) => {
    const next = identity(message);
    const changed = next !== previous;
    previous = next;
    storage?.setItem(key, next);
    return changed;
  };
}
