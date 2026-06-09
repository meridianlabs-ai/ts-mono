import { describe, expect, it } from "vitest";

import type { EvalRetryError } from "@tsmono/inspect-common";

import { attemptDuration, deriveErrorType } from "./retryAttempt";

function retry(partial: Partial<EvalRetryError>): EvalRetryError {
  return {
    message: "",
    traceback: "",
    traceback_ansi: "",
    events: null,
    ...partial,
  };
}

describe("deriveErrorType", () => {
  it("parses the exception class from the final traceback line", () => {
    const tb = [
      "Traceback (most recent call last):",
      '  File "flow.py", line 25, in solve',
      "    raise RuntimeError(msg)",
      "RuntimeError: Simulated failure for sample rec0Arme2jcXQZnAW",
    ].join("\n");
    expect(deriveErrorType(retry({ traceback: tb }))).toBe("RuntimeError");
  });

  it("strips a dotted module path to the bare class name", () => {
    const tb = "asyncio.exceptions.TimeoutError: timed out";
    expect(deriveErrorType(retry({ traceback: tb }))).toBe("TimeoutError");
  });

  it("handles an exception with no message (no colon)", () => {
    const tb = "Traceback ...\nKeyboardInterrupt";
    expect(deriveErrorType(retry({ traceback: tb }))).toBe("KeyboardInterrupt");
  });

  it("returns null when the final line is not an exception", () => {
    expect(deriveErrorType(retry({ traceback: "some free-form text 123 !!!" }))).toBeNull();
  });

  it("returns null for an empty traceback", () => {
    expect(deriveErrorType(retry({ traceback: "" }))).toBeNull();
  });
});

describe("attemptDuration", () => {
  it("returns the span in seconds between first and last event timestamps", () => {
    const events = [
      { event: "sample_init", timestamp: "2024-01-01T00:00:00.000Z" },
      { event: "error", timestamp: "2024-01-01T00:00:04.200Z" },
    ] as unknown as EvalRetryError["events"];
    expect(attemptDuration(retry({ events }))).toBeCloseTo(4.2, 3);
  });

  it("returns null when there are no events", () => {
    expect(attemptDuration(retry({ events: null }))).toBeNull();
    expect(attemptDuration(retry({ events: [] }))).toBeNull();
  });

  it("returns null when fewer than two events carry a timestamp", () => {
    const events = [
      { event: "sample_init", timestamp: "2024-01-01T00:00:00.000Z" },
    ] as unknown as EvalRetryError["events"];
    expect(attemptDuration(retry({ events }))).toBeNull();
  });
});
