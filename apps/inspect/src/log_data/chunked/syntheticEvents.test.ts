import { describe, expect, it } from "vitest";

import { syntheticEventsFromSkeleton } from "./syntheticEvents";
import type { SampleSkeleton } from "./types";
import { MAX_SYNTHETIC_MODELS, validateSkeleton } from "./validation";

const withModels = (models: number): SampleSkeleton => ({
  version: 1,
  counts: { events: models + 2, models },
  spans: [
    {
      id: "s",
      name: "s",
      begin: 0,
      extent: [0, models + 1],
      t: ["2024-01-01T00:00:00Z", "2024-01-01T00:00:01Z"],
      working: [0, 1],
      events: models + 2,
      models,
      gap_models: [models],
      children: { model: models },
    },
  ],
  notables: [],
  overflow: {},
});

describe("synthetic model budget", () => {
  it.each([Infinity, 1e9, MAX_SYNTHETIC_MODELS + 1])(
    "rejects %s models before generating events",
    (models) => {
      const skeleton = withModels(models);
      expect(() =>
        validateSkeleton(skeleton, skeleton.counts.events)
      ).toThrow();
      expect(() => syntheticEventsFromSkeleton(skeleton)).toThrow();
    }
  );

  it("budgets total expansion across spans rather than each gap separately", () => {
    const skeleton = withModels(MAX_SYNTHETIC_MODELS / 2 + 1);
    const span = skeleton.spans[0];
    if (!span) throw new Error("Missing fixture span");
    skeleton.spans.push({ ...span, id: "s2" });
    expect(() => syntheticEventsFromSkeleton(skeleton)).toThrow(
      "supported limit"
    );
  });

  it("preserves all 10,000 turns in a substantial valid sample", () => {
    const skeleton = withModels(10_000);
    validateSkeleton(skeleton, skeleton.counts.events);
    const stream = syntheticEventsFromSkeleton(skeleton);
    expect(
      stream.events.filter((event) => event.event === "model")
    ).toHaveLength(10_000);
    expect(stream.events).toHaveLength(10_002);
    expect(stream.ordinals.size).toBe(10_003);
  });
});
