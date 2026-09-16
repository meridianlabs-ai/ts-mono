import { describe, expect, it } from "vitest";

import { createWebviewStorage } from "@tsmono/util";

import { readLegacyRoute } from "./legacyRoute";
import { scanResultRoute, scanRoute } from "./url";

const scan = "team/scan_id=3oUGqQCpPQ9WSNPV4oy7Fe";
const storage = (state: unknown) =>
  createWebviewStorage({
    getState: () => ({
      "inspect-scout-storage": JSON.stringify({ version: 1, state }),
    }),
    setState: () => {},
    postMessage: () => {},
  });

describe("legacy Scout navigation migration", () => {
  it("resumes old scan snapshots using their remembered directory", () => {
    expect(
      readLegacyRoute(
        storage({ selectedScanLocation: scan, userScansDir: "/custom" }),
        "/scans"
      )
    ).toBe(scanRoute("/custom", scan));
  });
  it("resumes old result snapshots using the configured directory", () => {
    expect(
      readLegacyRoute(
        storage({ selectedScanLocation: scan, displayedScanResult: "result" }),
        "/scans"
      )
    ).toBe(scanResultRoute("/scans", scan, "result"));
  });
  it.each([
    null,
    {},
    { selectedScanLocation: 3 },
    { selectedScanLocation: "" },
  ])("ignores incomplete snapshots %s", (state) => {
    expect(readLegacyRoute(storage(state), "/scans")).toBeUndefined();
  });
});
