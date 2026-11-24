import { describe, expect, it } from "vitest";

import { workspaceTab } from "./useWorkspaceTab";

const rendered = ["samples", "task", "models", "timeline", "info", "json"];

describe("workspaceTab", () => {
  it.each([
    [
      "the URL's tab wins",
      "timeline",
      { status: "success", sampleCount: 0 },
      "timeline",
    ],
    [
      "finished with no samples",
      undefined,
      { status: "success", sampleCount: 0 },
      "info",
    ],
    [
      "errored with no samples",
      undefined,
      { status: "error", sampleCount: 0 },
      "info",
    ],
    [
      "running with no samples yet",
      undefined,
      { status: "started", sampleCount: 0 },
      "samples",
    ],
    [
      "finished with samples",
      undefined,
      { status: "success", sampleCount: 3 },
      "samples",
    ],
    ["details not loaded", undefined, undefined, "samples"],
    [
      "a tab the log doesn't render",
      "error",
      { status: "success", sampleCount: 0 },
      "info",
    ],
  ] as const)("%s", (_name, urlTab, details, expected) => {
    expect(workspaceTab(urlTab, rendered, details)).toBe(expected);
  });
});
