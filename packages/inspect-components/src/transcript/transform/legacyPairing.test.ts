import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isRecord } from "@tsmono/util";

import { deriveActivityData } from "../../sample-activity/activityData";

import { legacyFixtures, projectPairing } from "./legacyPairingFixtures";
import { pairToolApprovals } from "./toolApprovals";
import { pairToolSentinels } from "./toolSentinels";
import { treeifyEvents } from "./treeify";

// legacyPairing.main.json is `projectPairing` of each fixture through
// origin/main's implementation (fc3c943c, before execution_id), recorded by
// importing the fixtures into a `git archive` of that revision. A fixture
// added here needs its line recorded the same way.
const readRecorded = (): Record<string, string[]> => {
  const parsed: unknown = JSON.parse(
    readFileSync(new URL("./legacyPairing.main.json", import.meta.url), "utf8")
  );
  if (!isRecord(parsed)) throw new Error("recorded output is not an object");
  const recorded: Record<string, string[]> = {};
  for (const [name, lines] of Object.entries(parsed)) {
    if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) {
      throw new Error(`recorded output for "${name}" is not a list of lines`);
    }
    recorded[name] = lines;
  }
  return recorded;
};

const lib = {
  treeifyEvents,
  pairToolSentinels,
  pairToolApprovals,
  deriveActivityData,
};

describe("a log that records no execution_id", () => {
  const recorded = readRecorded();
  const fixtures = legacyFixtures();

  it("has origin/main's output recorded for every fixture", () => {
    expect(Object.keys(recorded).sort()).toEqual(
      fixtures.map((f) => f.name).sort()
    );
  });

  it.each(fixtures.map((f) => [f.name, f.events] as const))(
    "pairs and renders as origin/main did: %s",
    (name, events) => {
      expect(projectPairing(lib, events)).toEqual(recorded[name]);
    }
  );
});
