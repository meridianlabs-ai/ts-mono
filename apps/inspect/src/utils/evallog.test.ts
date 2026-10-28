import { describe, expect, it } from "vitest";

import { parseLogFileName } from "./evallog";

describe("parseLogFileName", () => {
  it("splits a standard log file name into its parts", () => {
    expect(
      parseLogFileName(
        "2026-10-08T00-55-17-00-00_task-with-default_PVpnSchEQSXxK3Nm4fBG3v.eval"
      )
    ).toEqual({
      timestamp: new Date("2026-10-08T00:55:17-00:00"),
      name: "task-with-default",
      taskId: "PVpnSchEQSXxK3Nm4fBG3v",
      extension: "eval",
    });
  });

  it("falls back to the file name for a non-standard name", () => {
    expect(parseLogFileName("logs/my-run.json")).toEqual({
      timestamp: undefined,
      name: "my-run",
      taskId: undefined,
      extension: "json",
    });
  });
});
