import type { Event } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";

import type { ScannerInputResponse, Transcript } from "../types/api-types";

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
