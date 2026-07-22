import { describe, expect, it } from "vitest";

import {
  chunkEntryName,
  chunkIndexOf,
  classifySampleShape,
  monolithEntryName,
  sequenceChunkStarts,
  shellEntryName,
  skeletonEntryName,
  statsEntryName,
} from "./format";

describe("entry naming", () => {
  it("names sample entries", () => {
    expect(monolithEntryName("abc", 2)).toBe("samples/abc_epoch_2.json");
    expect(shellEntryName(1, 1)).toBe("samples/1_epoch_1/sample.json");
    expect(skeletonEntryName(1, 1)).toBe("samples/1_epoch_1/skeleton.json");
    expect(statsEntryName(1, 1)).toBe("samples/1_epoch_1/events/stats.json");
    expect(chunkEntryName(1, 1, "messages", 1000)).toBe(
      "samples/1_epoch_1/messages/1000.json"
    );
  });

  it("classifies per-sample shape structurally", () => {
    const names = new Set([
      "samples/a_epoch_1.json",
      "samples/b_epoch_1/sample.json",
    ]);
    expect(classifySampleShape(names, "a", 1)).toBe("monolith");
    expect(classifySampleShape(names, "b", 1)).toBe("chunked");
    expect(classifySampleShape(names, "c", 1)).toBeUndefined();
  });
});

describe("chunk math", () => {
  it("recovers chunk starts from central-directory entry names", () => {
    const names = new Set([
      "samples/a_epoch_1/sample.json",
      "samples/a_epoch_1/events/1000.json",
      "samples/a_epoch_1/events/0.json",
      "samples/a_epoch_1/events/stats.json",
      "samples/a_epoch_1/messages/0.json",
      "samples/a_epoch_1/attachments/812.json.bak",
      "samples/aa_epoch_1/events/0.json",
    ]);
    // numeric stems only, sorted numerically; stats.json and foreign
    // prefixes are excluded
    expect(sequenceChunkStarts(names, "a", 1, "events")).toStrictEqual([
      0, 1000,
    ]);
    expect(sequenceChunkStarts(names, "a", 1, "messages")).toStrictEqual([0]);
    expect(sequenceChunkStarts(names, "a", 1, "attachments")).toStrictEqual([]);
    expect(sequenceChunkStarts(names, "a", 1, "calls")).toStrictEqual([]);
  });

  it("resolves index to chunk (greatest start ≤ i)", () => {
    const starts = [0, 1000, 2000];
    expect(chunkIndexOf(starts, 0)).toBe(0);
    expect(chunkIndexOf(starts, 999)).toBe(0);
    expect(chunkIndexOf(starts, 1000)).toBe(1);
    expect(chunkIndexOf(starts, 2209)).toBe(2);
  });
});
