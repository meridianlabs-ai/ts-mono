import { expect, it } from "vitest";

import { errorSummary } from "./startScanError";

it.each([
  [
    "traceback ending in a newline",
    JSON.stringify({
      detail:
        "Scan subprocess exited with code 1: Traceback\n  File x\nValueError: bad criteria\n",
    }),
    "ValueError: bad criteria",
  ],
  [
    "one-line detail",
    JSON.stringify({
      detail: "Scan subprocess failed to register within timeout",
    }),
    "Scan subprocess failed to register within timeout",
  ],
  ["non-JSON message", "Network Error", "Network Error"],
])("summarizes %s", (_name, message, summary) => {
  expect(errorSummary(message)).toBe(summary);
});
