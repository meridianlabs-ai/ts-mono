import {
  normalizeEvent,
  normalizeEvents,
} from "@tsmono/inspect-common/normalize";
import { expandEvents } from "@tsmono/inspect-common/utils";
import { isRecord } from "@tsmono/util";

import type { ScannerInputResponse, Transcript } from "../types/api-types";

import { resolveAttachments } from "./attachmentsHelpers";

/**
 * Expand condensed events in a scan result input.
 * Handles both "transcript" (events inside Transcript object) and "events" input types.
 *
 * `input` is raw wire data — scans written by older inspect_scout versions
 * carry shapes the generated types no longer admit — so it arrives as
 * `unknown` and leaves normalized (#555).
 */
export function expandInputEvents(
  input: unknown,
  inputType: ScannerInputResponse["input_type"],
  inputData: ScannerInputResponse["input_data"]
): ScannerInputResponse["input"] {
  const attachments = inputAttachments(inputData);
  const withAttachmentsResolved = (value: ScannerInputResponse["input"]) =>
    attachments && Object.keys(attachments).length > 0
      ? resolveAttachments(value, attachments)
      : value;

  // Boundary normalization (#555) applies with or without input_data: old
  // scans predate the input_data column entirely, and their transcript
  // events are exactly the ones that omit required-with-default fields.
  if (inputType === "transcript") {
    if (isTranscript(input)) {
      const transcript = input;
      const normalized = normalizeEvents(transcript.events);
      const expanded = inputData
        ? expandEvents(normalized, inputData)
        : normalized;
      const result =
        expanded === transcript.events
          ? transcript
          : { ...transcript, events: expanded };
      return withAttachmentsResolved(result);
    }
    // A stored transcript whose `events` is missing or malformed — exactly
    // the legacy-writer case this boundary exists for — is repaired to an
    // empty events list rather than handed downstream raw.
    if (isRecord(input)) {
      return withAttachmentsResolved(asInput({ ...input, events: [] }));
    }
    return withAttachmentsResolved(asInput(input));
  }

  if (inputType === "events") {
    const normalized = normalizeEvents(input);
    return withAttachmentsResolved(
      inputData ? expandEvents(normalized, inputData) : normalized
    );
  }

  if (inputType === "event") {
    return withAttachmentsResolved(normalizeEvent(input) ?? asInput(input));
  }

  return withAttachmentsResolved(asInput(input));
}

/**
 * Messages, timelines, and event shapes normalizeEvent doesn't recognize pass
 * through untouched: this hands the raw value back under the response's
 * declared input type, which is the same claim the response parse already
 * made about the JSON it came from.
 */
const asInput = (value: unknown): ScannerInputResponse["input"] =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- wire boundary (#555): see above
  value as ScannerInputResponse["input"];

/**
 * `input_type` and `input` are separate fields, so the discriminant on one
 * can't narrow the other; a transcript is the only input shape carrying an
 * events list.
 */
const isTranscript = (input: unknown): input is Transcript =>
  isRecord(input) && Array.isArray(input["events"]);

/**
 * EventsData is `additionalProperties: true`, so `attachments` isn't part of
 * its generated type — read it back out and keep only the string entries the
 * resolver can substitute.
 */
const inputAttachments = (
  inputData: ScannerInputResponse["input_data"]
): Record<string, string> | undefined => {
  if (!isRecord(inputData)) {
    return undefined;
  }
  const raw = inputData["attachments"];
  if (!isRecord(raw)) {
    return undefined;
  }
  const attachments: Record<string, string> = {};
  for (const [id, text] of Object.entries(raw)) {
    if (typeof text === "string") {
      attachments[id] = text;
    }
  }
  return attachments;
};
