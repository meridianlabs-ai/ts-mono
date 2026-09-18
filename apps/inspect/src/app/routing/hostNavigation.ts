import { basename, isUri, type WebviewStorage } from "@tsmono/util";

import type { UpdateStateMessage } from "../../client/api/types";

import { baseUrl } from "./url";

type Destination = UpdateStateMessage["data"];
const key = "inspect-host-destination-v1";
const identity = (message: Destination) =>
  JSON.stringify([message.url, message.sample_id, message.sample_epoch]);

export function hostDestinationRoute(message: Destination): string {
  const url = decodeURIComponent(message.url);
  return baseUrl(
    isUri(url) ? basename(url) : url,
    message.sample_id,
    message.sample_epoch
  );
}

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
