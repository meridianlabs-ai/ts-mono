import { describe, expect, it } from "vitest";

import { configuredSentinel } from "./sentinelConfig";

const rows = (config: unknown) =>
  configuredSentinel(config)?.rows.map(
    (r) => `${r.guides}${r.name} ${r.factory}`
  );

describe("configuredSentinel", () => {
  it("roots a lone entry at itself, naming children by mapping key or short registry name", () => {
    const config = {
      name: "inspect_sentinel/threshold",
      params: { escalate: 0.8 },
      version: 3,
      monitors: [
        { name: "inspect_sentinel/regex_scan" },
        { name: "llm_monitor" },
      ],
      fallback: { audit: { name: "human" } },
    };
    expect(configuredSentinel(config)).toMatchObject({
      name: "threshold",
      version: 3,
    });
    expect(rows(config)).toEqual([
      "(top) inspect_sentinel/threshold",
      "├─ regex_scan inspect_sentinel/regex_scan",
      "├─ llm_monitor llm_monitor",
      "└─ audit human",
    ]);
  });

  it("wraps a mapping of instances in concurrent, drawing nested layers", () => {
    const config = {
      guard: {
        name: "sequential",
        children: { net: { name: "no_network" }, files: { name: "protected" } },
      },
      audit: { name: "audit" },
    };
    expect(configuredSentinel(config)?.name).toBe("concurrent");
    expect(rows(config)).toEqual([
      "(top) inspect_sentinel/concurrent",
      "├─ guard sequential",
      "│  ├─ net no_network",
      "│  └─ files protected",
      "└─ audit audit",
    ]);
  });

  it("reads nothing from a config it can't parse", () => {
    expect(configuredSentinel(undefined)).toBeUndefined();
    expect(configuredSentinel("a_registry_name")).toBeUndefined();
  });
});
