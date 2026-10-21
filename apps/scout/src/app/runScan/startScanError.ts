import { isRecord } from "@tsmono/util";

// A failed start returns the scan subprocess's full traceback as
// `{"detail": ...}`; its last line names the actual error.
export const errorSummary = (message: string): string => {
  let text = message;
  try {
    const body: unknown = JSON.parse(message);
    if (isRecord(body) && typeof body.detail === "string") {
      text = body.detail;
    }
  } catch {
    // not a JSON error body; summarize the message itself
  }
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .pop() ?? message
  );
};
