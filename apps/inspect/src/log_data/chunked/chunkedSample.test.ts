import { describe, expect, it, vi } from "vitest";

import { openChunkedSample } from "./chunkedSample";
import type { SampleSkeleton } from "./types";

const skeleton = (): SampleSkeleton => ({
  version: 1,
  counts: { events: 3, models: 1 },
  spans: [
    {
      id: "s",
      name: "s",
      begin: 0,
      extent: [0, 2],
      t: ["2024-01-01T00:00:00Z", "2024-01-01T00:00:01Z"],
      working: [0, 1],
      events: 3,
      models: 1,
      gap_models: [1],
      children: { model: 1 },
    },
  ],
  notables: [],
  overflow: {},
});

const open = (refs: unknown = [[0, 1]], structure: unknown = skeleton()) => {
  const prefix = "samples/x_epoch_1";
  const files = new Map<string, unknown>([
    [`${prefix}/sample.json`, { id: "x", epoch: 1, message_refs: refs }],
    [`${prefix}/skeleton.json`, structure],
    [
      `${prefix}/events/stats.json`,
      {
        version: 1,
        chunks: [
          {
            start: 0,
            type_counts: { span_begin: 1, model: 1, span_end: 1 },
            first: { type: "span_begin" },
            last: { type: "span_end" },
          },
        ],
      },
    ],
    [`${prefix}/messages/0.json`, [{ role: "user", content: "hello" }]],
    [`${prefix}/events/0.json`, []],
  ]);
  const readFile = vi.fn((name: string) => {
    if (!files.has(name)) throw new Error(`Missing ${name}`);
    const json = JSON.stringify(files.get(name)).replaceAll('"1e400"', "1e400");
    return Promise.resolve(new TextEncoder().encode(json));
  });
  return {
    result: openChunkedSample({ readFile }, new Set(files.keys()), "x", 1),
    readFile,
  };
};

describe("chunked sidecar bounds", () => {
  it.each(
    [
      [[0, -1]],
      [[0, "x"]],
      [[0, "1e400"]],
      [[0, null]],
      [[0, 0.5]],
      [[0, 1e15]],
      [[1, 0]],
    ].map((refs) => ({ refs }))
  )(
    "rejects invalid message_refs %j before exposing the sample",
    async ({ refs }) => {
      await expect(open(refs).result).rejects.toThrow();
    }
  );

  it.each<[number, [number, number]]>([
    [0, [0, -1]],
    [1, [0, 0]],
    [0, [0, 3]],
  ])("rejects span begin %s outside extent %j", async (begin, extent) => {
    const structure = skeleton();
    const span = structure.spans[0];
    if (!span) throw new Error("Missing fixture span");
    span.begin = begin;
    span.extent = extent;
    await expect(open([], structure).result).rejects.toThrow();
  });

  it.each([1e9, "1e400", null, -1, 0.5])(
    "rejects invalid gap model count %s",
    async (count) => {
      const structure = skeleton();
      const span = structure.spans[0];
      if (!span) throw new Error("Missing fixture span");
      await expect(
        open([], {
          ...structure,
          spans: [{ ...span, gap_models: [count] }],
        }).result
      ).rejects.toThrow();
    }
  );

  it("opens a valid sample without reading event chunks", async () => {
    const { result, readFile } = open();
    const sample = await result;
    expect(sample.skeleton).toEqual(skeleton());
    expect(
      readFile.mock.calls.some(([name]) => /events\/\d+\.json$/.test(name))
    ).toBe(false);
    expect(await sample.messages.getRange(0, 1)).toEqual([
      { role: "user", content: "hello" },
    ]);
  });
});
