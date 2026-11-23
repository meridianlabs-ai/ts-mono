import { describe, expect, it } from "vitest";

import { errorType } from "./error";

describe("errorType", () => {
  it.each([
    ["RuntimeError('boom')", "RuntimeError"],
    ["CancelledError()", "CancelledError"],
    ["anyio.EndOfStream()", "anyio.EndOfStream"],
    [
      "Error code: 400 - {'error': {'message': 'prompt too long (130000 tokens)'}}",
      "Error",
    ],
    ["(no detail)", "Error"],
    ["timed out", "Error"],
    ["", "Error"],
    [undefined, "Error"],
  ])("reads %j as %j", (message, expected) => {
    expect(errorType(message)).toBe(expected);
  });
});
