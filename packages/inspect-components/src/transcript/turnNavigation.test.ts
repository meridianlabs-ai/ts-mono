import { describe, expect, it } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";

import type { TurnInfo } from "./outline/tree-visitors";
import {
  computeTurnAnchorIds,
  focusedTurnNodes,
  pickCurrentAnchorIndex,
} from "./turnNavigation";
import { EventNode } from "./types";

const node = (id: string): EventNode => ({ id }) as unknown as EventNode;

const treeNode = (
  id: string,
  type: string,
  depth: number,
  children: EventNode[] = []
): EventNode => {
  const n = new EventNode(id, { event: type } as Event, depth);
  n.children = children;
  return n;
};

const turnMap = (entries: Array<[string, number]>): Map<string, TurnInfo> =>
  new Map(
    entries.map(([id, turnNumber]) => [id, { turnNumber, totalTurns: 0 }])
  );

describe("computeTurnAnchorIds", () => {
  it("returns the first event of each turn, ignoring pre-turn chrome", () => {
    // init has no turn info; m1/m2 open turns 1/2, their tools inherit them.
    const nodes = [
      node("init"),
      node("m1"),
      node("t1"),
      node("m2"),
      node("t2"),
    ];
    const map = turnMap([
      ["m1", 1],
      ["t1", 1],
      ["m2", 2],
      ["t2", 2],
    ]);
    expect(computeTurnAnchorIds(nodes, map)).toEqual(["m1", "m2"]);
  });

  it("skips turns whose opening event is hidden (collapsed), keeping order", () => {
    // Turn 2's anchor isn't in the flattened list; turn 3 still resolves.
    const map = turnMap([
      ["m1", 1],
      ["m3", 3],
    ]);
    expect(computeTurnAnchorIds([node("m1"), node("m3")], map)).toEqual([
      "m1",
      "m3",
    ]);
  });

  it("returns an empty list when there are no turns", () => {
    expect(computeTurnAnchorIds([node("a")], turnMap([]))).toEqual([]);
  });
});

describe("focusedTurnNodes", () => {
  // A realistic react turn: model and tool at the same depth under a turn span,
  // with a sandbox sub-span elevated between them — the structure that broke the
  // naive "next sibling" slice.
  const tree = (): EventNode[] => [
    treeNode("turn1", "span_begin", 0, [
      treeNode("model1", "model", 1),
      treeNode("sb1", "span_begin", 1, [treeNode("sbx1", "sandbox", 2)]),
      treeNode("tool1", "tool", 1),
      treeNode("model2", "model", 1),
      treeNode("sb2", "span_begin", 1, [treeNode("sbx2", "sandbox", 2)]),
      treeNode("tool2", "tool", 1),
    ]),
  ];

  it("slices a turn's model + tool, dropping interleaved sandbox spans", () => {
    expect(focusedTurnNodes(tree(), "model1").map((n) => n.id)).toEqual([
      "model1",
      "tool1",
    ]);
  });

  it("stops at the next turn's model", () => {
    expect(focusedTurnNodes(tree(), "model2").map((n) => n.id)).toEqual([
      "model2",
      "tool2",
    ]);
  });

  it("returns an empty list for an unknown event id", () => {
    expect(focusedTurnNodes(tree(), "nope")).toEqual([]);
  });
});

describe("pickCurrentAnchorIndex", () => {
  // `line` is where scroll-to-turn lands a header. Current = last anchor at/above it.
  const line = 200;

  it("keeps the current turn while its header scrolls up past the line", () => {
    // turn 4 above the line, turn 5 still below → current is 4 (the off-by-one
    // Peter hit: the strip used to flip to 5 here).
    const anchors = [
      { index: 3, top: -700 },
      { index: 4, top: -100 },
      { index: 5, top: 760 },
    ];
    expect(pickCurrentAnchorIndex(anchors, line)).toBe(4);
  });

  it("treats a just-landed header (at the line) as the current turn", () => {
    const anchors = [
      { index: 3, top: -400 },
      { index: 4, top: 200 },
    ];
    expect(pickCurrentAnchorIndex(anchors, line)).toBe(4);
  });

  it("flips to the next turn once its header reaches the line", () => {
    const anchors = [
      { index: 4, top: -300 },
      { index: 5, top: 200 },
    ];
    expect(pickCurrentAnchorIndex(anchors, line)).toBe(5);
  });

  it("uses the first turn below the line at the very top of the transcript", () => {
    expect(pickCurrentAnchorIndex([{ index: 1, top: 400 }], line)).toBe(1);
  });

  it("returns -1 when there are no anchors", () => {
    expect(pickCurrentAnchorIndex([], line)).toBe(-1);
  });
});
