import type { Event } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";

import type { ScannerInputResponse, Transcript } from "../types/api-types";

import { resolveAttachments } from "./attachmentsHelpers";

/**
 * Expand condensed events in a scan result input.
 * Handles both "transcript" (events inside Transcript object) and "events" input types.
 */
export function expandInputEvents(
  input: ScannerInputResponse["input"],
  inputType: ScannerInputResponse["input_type"],
  inputData: ScannerInputResponse["input_data"]
): ScannerInputResponse["input"] {
  if (!inputData) return input;

  // EventsData is `additionalProperties: true`, so `attachments` isn't part
  // of its generated type; narrow just enough to read it back out.
  const attachments = (inputData as { attachments?: Record<string, string> })
    .attachments;
  const withAttachmentsResolved = (value: ScannerInputResponse["input"]) =>
    attachments && Object.keys(attachments).length > 0
      ? resolveAttachments(value, attachments)
      : value;

  if (inputType === "transcript") {
    const transcript = input as Transcript;
    const expanded = expandEvents(transcript.events, inputData);
    const result =
      expanded === transcript.events
        ? input
        : { ...transcript, events: expanded };
    return withAttachmentsResolved(result);
  }

  if (inputType === "events") {
    return withAttachmentsResolved(expandEvents(input as Event[], inputData));
  }

  return withAttachmentsResolved(input);
}
