import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testSentinelEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import { deriveActivityData } from "../../sample-activity/activityData";
import { EventNode } from "../types";

import { pairToolApprovals } from "./toolApprovals";
import { pairToolSentinels } from "./toolSentinels";
import { treeifyEvents } from "./treeify";

const kAgent = "agent";
const kModelId = "call_1";

/**
 * A bridged agent whose model reuses one call id on every turn, with a
 * sentinel watching only tool results and no approval policy: each turn
 * proposes a different call, the bridge runs it on the host under a fresh
 * id, and a result check records that id as its `execution_id`. Every read
 * of a proposed call's arguments is counted.
 */
const reusedIdSample = (runs: number) => {
  let reads = 0;
  let toolIdReads = 0;
  const counted = (args: Record<string, unknown>) =>
    new Proxy(args, {
      get: (target, key, receiver: unknown): unknown => {
        reads++;
        return Reflect.get(target, key, receiver);
      },
      ownKeys: (target) => {
        reads++;
        return Reflect.ownKeys(target);
      },
    });
  const at = (seconds: number) => new Date(seconds * 1000).toISOString();
  const events: Event[] = [
    testSpanBeginEvent({ id: kAgent, name: "agent", type: "agent" }),
  ];
  for (let i = 0; i < runs; i++) {
    const execution = i === 0 ? kModelId : `tok-${i}`;
    const check = `check-${i}`;
    events.push(
      testModelEvent({
        uuid: `m-${i}`,
        span_id: kAgent,
        timestamp: at(i),
        requested_model: "client",
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({
                tool_calls: [
                  testToolCall({
                    id: kModelId,
                    function: "mcp__host__read_file",
                    arguments: counted({ path: `file-${i}.txt` }),
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
      testToolEvent({
        uuid: `t-${i}`,
        id: execution,
        function: "read_file",
        span_id: kAgent,
        timestamp: at(i + 0.1),
        arguments: { path: `file-${i}.txt` },
        metadata: {
          bridge: {
            server: "host",
            tool: "read_file",
            function: "mcp__host__read_file",
            proposal_id: kModelId,
            grant: "consumed",
          },
        },
      }),
      testSpanBeginEvent({
        id: check,
        name: "sentinel_bridge",
        type: "sentinel",
        parent_id: kAgent,
        span_id: kAgent,
        timestamp: at(i + 0.2),
      }),
      testSentinelEvent({
        uuid: check,
        span_id: check,
        timestamp: at(i + 0.25),
        stage: "tool_result",
        step_id: kModelId,
        execution_id: execution === kModelId ? null : execution,
        conversation: kAgent,
        kind: "decision",
        action: "proceed",
      }),
      testSpanEndEvent({ id: check, span_id: kAgent })
    );
  }
  return {
    events,
    reads: () => reads,
    toolIdReads: () => toolIdReads,
    countToolIdReads: (nodes: EventNode[]) => {
      const count = (level: EventNode[]) => {
        for (const node of level) {
          if (node.event.event === "tool") {
            node.event = new Proxy(node.event, {
              get: (target, key, receiver: unknown): unknown => {
                if (key === "id") toolIdReads++;
                return Reflect.get(target, key, receiver);
              },
            });
          }
          count(node.children);
        }
      };
      count(nodes);
    },
  };
};

const readsFor = (
  runs: number,
  derive: (events: Event[]) => unknown
): number => {
  const sample = reusedIdSample(runs);
  const before = sample.reads();
  derive(sample.events);
  return sample.reads() - before;
};

describe("proposal lookup for runs that reuse one call id", () => {
  it.each([
    [
      "the transcript",
      (events: Event[]) => pairToolSentinels(treeifyEvents(events, 0)),
    ],
    ["Activity", (events: Event[]) => deriveActivityData({ events })],
  ])(
    "reads proposed calls at most linearly in the number of runs in %s",
    (_view, derive) => {
      const counts = [100, 200, 400, 800].map((runs) => readsFor(runs, derive));
      // Eight times the runs within a margin of eight times the reads; a
      // quadratic pass would read 64 times as much.
      expect(counts[3]).toBeLessThanOrEqual(10 * (counts[0] ?? 0));
      expect(counts[0]).toBeGreaterThan(0);
    }
  );
});

/** Steps through arrays while `run` runs, counting every element visited. */
const arraySteps = (run: () => void): number => {
  const original = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator
  );
  const iterate = original?.value as unknown;
  if (typeof iterate !== "function") throw new Error("no array iterator");
  let steps = 0;
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    ...original,
    value: function* (this: unknown[]) {
      for (let i = 0; i < this.length; i++) {
        steps++;
        yield this[i];
      }
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, original ?? {});
  }
  return steps;
};

describe("pairing runs that reuse one call id", () => {
  it("reads tool ids at most linearly in the number of runs in the transcript", () => {
    const counts = [100, 200, 400, 800].map((runs) => {
      const sample = reusedIdSample(runs);
      const nodes = treeifyEvents(sample.events, 0);
      sample.countToolIdReads(nodes);
      pairToolSentinels(nodes);
      return sample.toolIdReads();
    });
    expect(counts[3]).toBeLessThanOrEqual(10 * (counts[0] ?? 0));
    expect(counts[0]).toBeGreaterThan(0);
  });

  it("pairs approvals in linear work when a native model reuses one id and no approval is recorded", () => {
    const steps = [500, 1000, 2000, 4000].map((runs) => {
      const nodes = Array.from(
        { length: runs },
        (_, i) =>
          new EventNode(
            `t-${i}`,
            testToolEvent({ uuid: `t-${i}`, id: kModelId }),
            0
          )
      );
      return arraySteps(() => pairToolApprovals(nodes));
    });
    expect(steps[3]).toBeLessThanOrEqual(10 * (steps[0] ?? 0));
    expect(steps[0]).toBeGreaterThan(0);
  });
});
