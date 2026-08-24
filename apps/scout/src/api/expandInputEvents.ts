import { normalizeEvents } from "@tsmono/inspect-common/normalize";
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
  // EventsData is `additionalProperties: true`, so `attachments` isn't part
  // of its generated type; narrow just enough to read it back out.
  const attachments = inputData
    ? (inputData as { attachments?: Record<string, string> }).attachments
    : undefined;
  const withAttachmentsResolved = (value: ScannerInputResponse["input"]) =>
    attachments && Object.keys(attachments).length > 0
      ? resolveAttachments(value, attachments)
      : value;

  // Boundary normalization (#555) applies with or without input_data: old
  // scans predate the input_data column entirely, and their transcript
  // events are exactly the ones that omit required-with-default fields.
  if (inputType === "transcript") {
    const transcript = input as Transcript;
    const normalized = normalizeEvents(transcript.events);
    const expanded = inputData
      ? expandEvents(normalized, inputData)
      : normalized;
    const result =
      expanded === transcript.events
        ? input
        : { ...transcript, events: expanded };
    return withAttachmentsResolved(result);
  }

  if (inputType === "events") {
    const normalized = normalizeEvents(input);
    return withAttachmentsResolved(
      inputData ? expandEvents(normalized, inputData) : normalized
    );
  }

  return withAttachmentsResolved(input);
}
