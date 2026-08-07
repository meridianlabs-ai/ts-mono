import type { Event } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";

import type { ScannerInputResponse, Transcript } from "../types/api-types";

import { resolveAttachments } from "./attachmentsHelpers";

type InputData = NonNullable<ScannerInputResponse["input_data"]>;

/**
 * The attachments table travelling alongside the event pools in `input_data`.
 *
 * `EventsData` is `additionalProperties: true`, so the generated type exposes
 * this through an index signature of `unknown` -- hence the runtime check.
 */
function inputAttachments(inputData: InputData): Record<string, string> | null {
  const attachments = inputData["attachments"];
  if (typeof attachments !== "object" || attachments === null) return null;
  const entries = Object.entries(attachments).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Restore a scan result input to its readable form.
 *
 * Recorded inputs are stored compactly: events carry range-encoded pool refs,
 * and repeated content is replaced by `attachment://<hash>` refs resolved
 * against a table in `input_data`. Both have to be undone for display, in that
 * order -- refs also occur inside pool entries, so they only become reachable
 * once the pools are expanded.
 *
 * Attachment resolution covers the whole input rather than only the events,
 * because messages and sample metadata carry refs too.
 */
export function expandInputEvents(
  input: ScannerInputResponse["input"],
  inputType: ScannerInputResponse["input_type"],
  inputData: ScannerInputResponse["input_data"]
): ScannerInputResponse["input"] {
  if (!inputData) return input;

  const expanded = expandPooledEvents(input, inputType, inputData);
  const attachments = inputAttachments(inputData);
  return attachments ? resolveAttachments(expanded, attachments) : expanded;
}

/**
 * Expand condensed events in a scan result input.
 * Handles both "transcript" (events inside Transcript object) and "events" input types.
 */
function expandPooledEvents(
  input: ScannerInputResponse["input"],
  inputType: ScannerInputResponse["input_type"],
  inputData: InputData
): ScannerInputResponse["input"] {
  if (inputType === "transcript") {
    const transcript = input as Transcript;
    const expanded = expandEvents(transcript.events, inputData);
    return expanded === transcript.events
      ? input
      : { ...transcript, events: expanded };
  }

  if (inputType === "events") {
    return expandEvents(input as Event[], inputData);
  }

  return input;
}
