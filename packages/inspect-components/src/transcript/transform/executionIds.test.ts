import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeEvents } from "@tsmono/inspect-common/normalize";
import type { Event } from "@tsmono/inspect-common/types";
import { isRecord } from "@tsmono/util";

import { deriveActivityData } from "../../sample-activity/activityData";

import { pairToolApprovals } from "./toolApprovals";
import { pairToolSentinels } from "./toolSentinels";
import { treeifyEvents } from "./treeify";

// Samples recorded by inspect_ai#6370 (mockllm evals in its sentinel tests'
// harness), trimmed of model inputs and tool views. There every run carries
// the `execution_id` its approvals and tool checks record.
const readFixtures = (): Record<string, Event[]> => {
  const parsed: unknown = JSON.parse(
    readFileSync(
      new URL("./executionIds.fixtures.json", import.meta.url),
      "utf8"
    )
  );
  if (!isRecord(parsed)) throw new Error("fixtures are not an object");
  return Object.fromEntries(
    Object.entries(parsed).map(([name, raw]) => [name, normalizeEvents(raw)])
  );
};
const fixtures = readFixtures();

const sample = (name: string): Event[] => {
  const events = fixtures[name];
  if (!events) throw new Error(`no fixture ${name}`);
  return events;
};

/** Names each run, approval and tool step by its stage and recording order. */
const labeller = (events: Event[]) => {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  const label = (uuid: string | null | undefined, kind: string) => {
    if (!uuid || labels.has(uuid)) return;
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    labels.set(uuid, `${kind} ${n}`);
  };
  const stepKinds = new Map<string, string>();
  for (const event of events) {
    if (event.event === "tool") label(event.uuid, `run`);
    else if (event.event === "approval") label(event.uuid, "approval");
    else if (event.event === "sentinel") {
      // A step is named by its first event, which keys its view state.
      const key = `${event.span_id}\u0000${event.stage}`;
      if (stepKinds.has(key)) continue;
      stepKinds.set(key, event.stage);
      label(event.uuid, event.stage === "tool_call" ? "call" : "result");
    }
  }
  return (id: string | undefined) => (id ? (labels.get(id) ?? id) : undefined);
};

/** What the transcript shows: each run's panel, and the steps and approvals left on their own rows. */
const transcript = (events: Event[]) => {
  const name = labeller(events);
  const nodes = treeifyEvents(events, 0);
  const sentinels = pairToolSentinels(nodes);
  const approvals = pairToolApprovals(nodes);
  const runs: Record<string, unknown> = {};
  for (const event of events) {
    if (event.event !== "tool" || !event.uuid) continue;
    const paired = sentinels.toolSentinels.get(event.uuid);
    runs[name(event.uuid)!] = {
      before: name(paired?.before?.id),
      after: name(paired?.after?.id),
      approvals: (approvals.toolApprovals.get(event.uuid) ?? []).map((n) =>
        name(n.id)
      ),
    };
  }
  return {
    runs,
    standaloneSteps: [...sentinels.standaloneSentinels.values()]
      .map((step) => name(step.id))
      .sort(),
    standaloneApprovals: events
      .flatMap((event) =>
        event.event === "approval" &&
        event.uuid &&
        !approvals.hiddenApprovalIds.has(event.uuid)
          ? [name(event.uuid)]
          : []
      )
      .sort(),
  };
};

/** Activity's decision and approval rows: what each names and says. */
const activity = (events: Event[]) =>
  deriveActivityData({ events })
    .rows.filter((row) => row.category === "approval")
    .map((row) => [row.lead, row.mono, row.tail]);

const run = (
  before?: string,
  after?: string,
  approvals: string[] = []
): { before?: string; after?: string; approvals: string[] } => ({
  before,
  after,
  approvals,
});

describe("a log whose runs record execution_id (inspect_ai#6370)", () => {
  describe("native calls, which mint an id per run", () => {
    it("pairs each run of a reused call id with its own approval and checks", () => {
      expect(transcript(sample("native_repeated"))).toEqual({
        runs: {
          "run 1": run("call 1", "result 1", ["approval 1"]),
          "run 2": run("call 2", "result 2", ["approval 2"]),
        },
        standaloneSteps: [],
        standaloneApprovals: [],
      });
    });

    it("names each run's proposal from its own approval when the call id was reused for different calls", () => {
      const events = sample("native_repeated");
      const { toolSentinels } = pairToolSentinels(treeifyEvents(events, 0));
      const proposed = events.flatMap((event) =>
        event.event === "tool" && event.uuid
          ? [toolSentinels.get(event.uuid)?.proposed?.arguments]
          : []
      );
      expect(proposed).toEqual([
        { x: 1, y: 1 },
        { x: 2, y: 1 },
      ]);
    });

    it("pairs approvals with their runs when only an approval policy is set", () => {
      expect(transcript(sample("native_approval_only"))).toEqual({
        runs: {
          "run 1": run(undefined, undefined, ["approval 1"]),
          "run 2": run(undefined, undefined, ["approval 2"]),
        },
        standaloneSteps: [],
        standaloneApprovals: [],
      });
    });

    it("pairs a rejected attempt's approval with its failed run, and the retry's records with the retry", () => {
      const events = sample("native_rejected");
      expect(transcript(events)).toEqual({
        runs: {
          "run 1": run(undefined, undefined, ["approval 1"]),
          "run 2": run("call 1", "result 1", ["approval 2"]),
        },
        standaloneSteps: [],
        standaloneApprovals: [],
      });
      expect(activity(events)).toEqual([
        ["Tool call", "addition: x: 1, y: 1", "rejected"],
      ]);
    });

    it("lets a check that rejects the call overrule the approval that modified it, and names the call as proposed", () => {
      const events = sample("native_modified_rejected");
      expect(transcript(events)).toEqual({
        runs: {
          "run 1": run("call 1", undefined, ["approval 1"]),
          "run 2": run(undefined, undefined, ["approval 2"]),
        },
        standaloneSteps: [],
        standaloneApprovals: [],
      });
      expect(activity(events)).toEqual([
        ["Tool call", "addition: x: 1, y: 1", "rejected"],
      ]);
    });

    it("names the call each rejected result came from", () => {
      expect(activity(sample("native_results_rejected"))).toEqual([
        ["Tool result", "addition: x: 1, y: 1", "rejected"],
        ["Tool result", "addition: x: 2, y: 1", "rejected"],
      ]);
    });
  });

  // One output proposes two calls under one id, which run in parallel; the
  // second completes, and is checked, first.
  describe("parallel calls that share an id and complete out of order", () => {
    it.each([
      ["native_parallel_same_id_observed", []],
      ["native_parallel_same_id_observed_approved", ["approval 1"]],
    ] as const)(
      "pairs each call with its own checks and approval (%s)",
      (name, firstApprovals) => {
        const approved = firstApprovals.length > 0;
        expect(transcript(sample(name))).toEqual({
          runs: {
            "run 1": run("call 1", "result 2", [...firstApprovals]),
            "run 2": run("call 2", "result 1", approved ? ["approval 2"] : []),
          },
          standaloneSteps: [],
          standaloneApprovals: [],
        });
      }
    );

    it.each(["native_parallel_same_id", "native_parallel_same_id_approved"])(
      "shows a decision that terminated on the second call's result against the second call (%s)",
      (name) => {
        const events = sample(name);
        expect(transcript(events).runs["run 2"]).toEqual(
          expect.objectContaining({ after: "result 1" })
        );
        expect(activity(events)).toEqual([
          ["Tool result", "labelled: second", "terminated"],
        ]);
      }
    );
  });

  describe("bridged host calls, which mint an id per handout", () => {
    it("pairs each handout of a call id with its own run, and leaves results that can't be told apart on their own", () => {
      // The second handout makes the id ambiguous, so the results checked
      // after it (a re-check of the first and the second's) name no handout.
      expect(transcript(sample("bridge_repeated"))).toEqual({
        runs: {
          "run 1": run("call 1", "result 1", ["approval 1"]),
          "run 2": run("call 2", undefined, ["approval 2"]),
        },
        standaloneSteps: ["result 2", "result 3"],
        standaloneApprovals: [],
      });
    });

    it("pairs each handout of a call a cache hit returned again with its own run", () => {
      expect(transcript(sample("bridge_repeated_cached"))).toEqual({
        runs: {
          "run 1": run("call 1", undefined, ["approval 1"]),
          "run 2": run("call 2", undefined, ["approval 2"]),
        },
        standaloneSteps: ["result 1", "result 2"],
        standaloneApprovals: [],
      });
    });

    it("names a call from its handout's run when a result check of it rejects, and none when the handout can't be told", () => {
      expect(activity(sample("bridge_repeated_results_rejected"))).toEqual([
        ["Tool result", "mcp__host__read_file: notes.txt", "rejected"],
        ["Tool result", undefined, "rejected"],
        ["Tool result", undefined, "rejected"],
      ]);
    });

    it("pairs both runs of one handout with the handout's checks, and each with its own tool's approval", () => {
      // The call denotes two bridged tools, and the scaffold runs it on each.
      expect(transcript(sample("bridge_run_twice"))).toEqual({
        runs: {
          "run 1": run("call 1", "result 1", ["approval 1"]),
          "run 2": run("call 2", "result 2", ["approval 2"]),
        },
        standaloneSteps: [],
        standaloneApprovals: [],
      });
    });

    it("names the call of each run of one handout when its result check rejects", () => {
      const events = sample("bridge_run_twice_results_rejected");
      expect(transcript(events)).toEqual({
        runs: {
          "run 1": run(undefined, "result 1", ["approval 1"]),
          "run 2": run(undefined, "result 2", ["approval 2"]),
        },
        standaloneSteps: [],
        standaloneApprovals: [],
      });
      expect(activity(events)).toEqual([
        ["Tool result", "mcp__host__read_file: notes.txt", "rejected"],
        ["Tool result", "mcp__host__read_file: notes.txt", "rejected"],
      ]);
    });

    // The scaffold loses the first response and asks again, so the call id
    // is handed out twice and a run matching both grants names neither.
    it("pairs no handout's records with a run that matched two handouts, and its result by the call id when it ran once", () => {
      expect(transcript(sample("bridge_ambiguous_1"))).toEqual({
        runs: { "run 1": run(undefined, "result 1") },
        standaloneSteps: ["call 1", "call 2"],
        standaloneApprovals: ["approval 1", "approval 2"],
      });
    });

    it("leaves a result that names no handout on its own when two runs share its call id", () => {
      expect(transcript(sample("bridge_ambiguous_2"))).toEqual({
        runs: { "run 1": run(), "run 2": run() },
        standaloneSteps: ["call 1", "call 2", "result 1"],
        standaloneApprovals: ["approval 1", "approval 2"],
      });
    });
  });
});
