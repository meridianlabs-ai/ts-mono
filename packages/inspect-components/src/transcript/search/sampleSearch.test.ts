// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  testApprovalEvent,
  testAssistantMessage,
  testChatCompletionChoice,
  testInfoEvent,
  testModelEvent,
  testModelOutput,
  testSystemMessage,
  testToolCall,
  testToolEvent,
  testToolMessage,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type {
  ChatMessage,
  ChatMessageAssistant,
  Event,
  ModelEvent,
} from "@tsmono/inspect-common/types";

import { TimelineEvent, TimelineSpan } from "../timeline/core";
import type { SwimlaneRow } from "../timeline/swimlaneRows";

import { buildEventToRowMap, findAllMatches } from "./sampleSearch";

const ev = (uuid: string): TimelineEvent =>
  new TimelineEvent(
    testInfoEvent({
      uuid,
      timestamp: "2026-04-29T00:00:00Z",
      pending: false,
      span_id: null,
      source: null,
      data: null,
      metadata: null,
    })
  );

const span = (
  id: string,
  content: (TimelineEvent | TimelineSpan)[],
  spanType: string | null = "agent"
): TimelineSpan => new TimelineSpan({ id, name: id, spanType, content });

const row = (key: string, agent: TimelineSpan, depth = 0): SwimlaneRow => ({
  key,
  name: agent.name,
  depth,
  spans: [{ agent }],
  totalTokens: 0,
  startTime: new Date(0),
  endTime: new Date(0),
});

describe("buildEventToRowMap", () => {
  it("maps events directly under a row's agent to that row", () => {
    const e1 = ev("e1");
    const e2 = ev("e2");
    const main = span("main", [e1, e2]);
    const map = buildEventToRowMap([row("main", main)]);
    expect(map.get("e1")).toBe("main");
    expect(map.get("e2")).toBe("main");
  });

  it("maps events under a non-agent child span to the parent agent's row", () => {
    const e1 = ev("e1");
    const inner = span("step1", [e1], "step");
    const main = span("main", [inner]);
    const map = buildEventToRowMap([row("main", main)]);
    expect(map.get("e1")).toBe("main");
  });

  it("does not map events under a nested agent span to the outer row", () => {
    const eOuter = ev("eOuter");
    const eInner = ev("eInner");
    const subAgent = span("sub", [eInner], "agent");
    const main = span("main", [eOuter, subAgent]);
    // Both rows present in state.rows
    const rows: SwimlaneRow[] = [
      row("main", main, 0),
      row("main/sub", subAgent, 1),
    ];
    const map = buildEventToRowMap(rows);
    expect(map.get("eOuter")).toBe("main");
    expect(map.get("eInner")).toBe("main/sub");
  });

  it("uses the deepest matching row when an event appears reachable via multiple", () => {
    // Defensive: shouldn't happen in practice, but the rule is "deepest wins".
    const e1 = ev("e1");
    const sub = span("sub", [e1], "agent");
    const main = span("main", [sub]);
    const rows: SwimlaneRow[] = [row("main", main, 0), row("main/sub", sub, 1)];
    const map = buildEventToRowMap(rows);
    expect(map.get("e1")).toBe("main/sub");
  });

  it("handles parallel-span rows (multiple agents in one row)", () => {
    const e1 = ev("e1");
    const e2 = ev("e2");
    const a1 = span("a1", [e1]);
    const a2 = span("a2", [e2]);
    const parallelRow: SwimlaneRow = {
      key: "parallel",
      name: "parallel",
      depth: 0,
      spans: [{ agents: [a1, a2] }],
      totalTokens: 0,
      startTime: new Date(0),
      endTime: new Date(0),
    };
    const map = buildEventToRowMap([parallelRow]);
    expect(map.get("e1")).toBe("parallel");
    expect(map.get("e2")).toBe("parallel");
  });

  it("returns an empty map for empty rows", () => {
    expect(buildEventToRowMap([]).size).toBe(0);
  });
});

const modelEv = (uuid: string, output: string): ModelEvent =>
  testModelEvent({
    uuid,
    span_id: null,
    timestamp: "2026-04-29T00:00:00Z",
    pending: false,
    model: "test/model",
    role: null,
    output: testModelOutput({
      model: "test/model",
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({
            content: output,
            source: "generate",
          }),
        }),
      ],
      usage: null,
    }),
    error: null,
    cache: null,
    call: null,
    completed: null,
    working_time: null,
    metadata: null,
  });

describe("findAllMatches", () => {
  it("returns empty for empty term", () => {
    const events: Event[] = [modelEv("e1", "I'm wondering")];
    const map = new Map([["e1", "main"]]);
    expect(findAllMatches(events, "", map)).toEqual([]);
  });

  it("returns empty when term is not present", () => {
    const events: Event[] = [modelEv("e1", "hello world")];
    const map = new Map([["e1", "main"]]);
    expect(findAllMatches(events, "absent", map)).toEqual([]);
  });

  it("finds a single match in model output", () => {
    const events: Event[] = [modelEv("e1", "I'm wondering")];
    const map = new Map([["e1", "main"]]);
    const matches = findAllMatches(events, "wondering", map);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      rowKey: "main",
      eventId: "e1",
      fieldKey: "output",
      occurrenceIndex: 0,
    });
  });

  it("is case-insensitive", () => {
    const events: Event[] = [modelEv("e1", "WonderingAgain")];
    const map = new Map([["e1", "main"]]);
    expect(findAllMatches(events, "wonder", map)).toHaveLength(1);
  });

  it("finds multiple occurrences in a single field with stable order", () => {
    const events: Event[] = [modelEv("e1", "wondering wondering wondering")];
    const map = new Map([["e1", "main"]]);
    const matches = findAllMatches(events, "wondering", map);
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.occurrenceIndex)).toEqual([0, 1, 2]);
  });

  it("tags matches with the correct row when events span multiple rows", () => {
    const events: Event[] = [
      modelEv("e1", "wondering up here"),
      modelEv("e2", "wondering down there"),
    ];
    const map = new Map([
      ["e1", "main"],
      ["e2", "main/sub"],
    ]);
    const matches = findAllMatches(events, "wondering", map);
    expect(matches.map((m) => m.rowKey)).toEqual(["main", "main/sub"]);
  });

  it("preserves event-array order across rows", () => {
    const events: Event[] = [
      modelEv("e1", "wondering"),
      modelEv("e2", "wondering"),
      modelEv("e3", "wondering"),
    ];
    const map = new Map([
      ["e1", "main"],
      ["e2", "main/sub"],
      ["e3", "main"],
    ]);
    const matches = findAllMatches(events, "wondering", map);
    expect(matches.map((m) => m.eventId)).toEqual(["e1", "e2", "e3"]);
  });

  it("skips events whose uuid is not in the row map (defensive)", () => {
    const events: Event[] = [modelEv("e1", "wondering")];
    const map = new Map<string, string>(); // empty
    expect(findAllMatches(events, "wondering", map)).toEqual([]);
  });

  // Mirrors the variant matching LiveVirtualList does for the chat counter:
  // a quoted search like `"foo"` should match the bare `foo` in JSON-like
  // text too, and a JSON-quoted occurrence should count once (not twice
  // for both the quoted and unquoted forms).
  it("counts quoted-search variants and dedupes overlapping matches", () => {
    // `"foo"` (quoted) and `foo` (unquoted) both appear; the literal `"foo"`
    // is matched by both variants but should only count as one occurrence.
    const events: Event[] = [modelEv("e1", `prefix "foo" middle foo end`)];
    const map = new Map([["e1", "main"]]);
    const matches = findAllMatches(events, `"foo"`, map);
    // Two distinct positions: the `"foo"` literal and the bare `foo`.
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.occurrenceIndex)).toEqual([0, 1]);
  });

  // The viewer's page Find collapses whitespace and folds case this way, so
  // a row's count matches what it shows once rendered.
  it("matches across runs of spaces and folds case as the page does", () => {
    const events: Event[] = [modelEv("e1", "ΟΔΟΣ hello \t  world")];
    const map = new Map([["e1", "main"]]);
    expect(findAllMatches(events, "hello world", map)).toHaveLength(1);
    expect(findAllMatches(events, "σ", map)).toHaveLength(1);
  });
});

describe("findAllMatches: what model call and tool panels draw", () => {
  const prompt = [
    testSystemMessage({ content: "Never mention the kumquat." }),
    testUserMessage({ content: "Count every kumquat." }),
  ];
  const args = { cmd: "grep persimmon notes.txt" };
  const call = testToolCall({
    id: "call-1",
    function: "bash",
    arguments: args,
  });
  const step = testAssistantMessage({
    content: "Looking.",
    tool_calls: [call],
  });
  const result = testToolMessage({
    content: "one quince found",
    tool_call_id: call.id,
    function: "bash",
  });
  const modelCall = (
    uuid: string,
    input: ChatMessage[],
    message: ChatMessageAssistant
  ): ModelEvent =>
    testModelEvent({
      uuid,
      input,
      output: testModelOutput({
        choices: [testChatCompletionChoice({ message })],
      }),
    });
  const first = modelCall("m1", prompt, step);
  const second = modelCall(
    "m2",
    [...prompt, step, result],
    testAssistantMessage({ content: "Done." })
  );
  const toolRun = testToolEvent({
    uuid: "t1",
    id: call.id,
    function: "bash",
    arguments: args,
    result: "one quince found",
  });
  const rows = new Map(["m1", "t1", "m2"].map((id) => [id, "main"]));
  const matchedEvents = (events: Event[], term: string) =>
    findAllMatches(events, term, rows).map((match) => match.eventId);

  it("counts the prompt only on the call that draws it", () => {
    expect(matchedEvents([first, toolRun, second], "kumquat")).toEqual([
      "m1",
      "m1",
    ]);
  });

  it("leaves a tool call and its result to the tool event that shows them", () => {
    const events = [first, toolRun, second];
    expect(matchedEvents(events, "persimmon")).toEqual(["t1"]);
    expect(matchedEvents(events, "quince")).toEqual(["t1"]);
  });

  it("counts a tool call and its result that no tool event shows", () => {
    const events = [first, second];
    expect(matchedEvents(events, "persimmon")).toEqual(["m1"]);
    expect(matchedEvents(events, "quince")).toEqual(["m2"]);
  });

  it("skips a tool event's argument name, which its panel doesn't draw", () => {
    expect(matchedEvents([first, toolRun, second], "cmd")).toEqual([]);
  });

  it("counts every argument of a tool whose panel lists them", () => {
    const lookup = testToolEvent({
      uuid: "t1",
      function: "lookup",
      arguments: { fruit: "medlar" },
    });
    expect(matchedEvents([lookup], "fruit")).toEqual(["t1"]);
    // The block lists the arguments apart from the name.
    expect(matchedEvents([lookup], "lookup(")).toEqual([]);
  });

  it("counts a tool's name once for each place its panel draws it", () => {
    // A tool event's panel titles itself and its block; a call a model call's
    // panel draws has the block alone.
    expect(matchedEvents([toolRun], "bash")).toEqual(["t1", "t1"]);
    expect(matchedEvents([first], "bash")).toEqual(["m1"]);
  });

  it("counts a tool event's custom view in place of its arguments", () => {
    const opened = testToolEvent({
      uuid: "t1",
      function: "open_file",
      arguments: { path: "notes.txt" },
      view: {
        title: "Open {{path}}",
        format: "markdown",
        content: "Reading {{path}} aloud",
      },
    });
    expect(matchedEvents([opened], "aloud")).toEqual(["t1"]);
    expect(matchedEvents([opened], "path")).toEqual([]);
  });

  it("counts a todo list's items, not the fields that hold them", () => {
    const planned = testToolEvent({
      uuid: "t1",
      function: "TodoWrite",
      arguments: { todos: [{ content: "Buy a medlar", status: "pending" }] },
    });
    expect(matchedEvents([planned], "medlar")).toEqual(["t1"]);
    expect(matchedEvents([planned], "pending")).toEqual([]);
  });

  // inspect_ai's bash and python tools record a view of the code they run.
  const codeView = (language: string, code: string) => ({
    title: language,
    format: "markdown" as const,
    content: `\`\`\`${language}\n${code}\n\`\`\`\n`,
  });

  it.each([
    ["in the view the call records, not again in its input", args.cmd],
    ["in its input when the panel rejects the recorded view", "bash"],
  ])("counts a command once: %s", (_where, viewedCode) => {
    const ran = testToolEvent({
      uuid: "t1",
      function: "bash",
      arguments: args,
      view: codeView("bash", viewedCode),
    });
    expect(matchedEvents([ran], "persimmon")).toEqual(["t1"]);
  });

  it("skips the fence around a view's code, which the panel renders away", () => {
    const scripted = testToolEvent({
      uuid: "t1",
      function: "run_script",
      arguments: { source: "print(1)" },
      view: { ...codeView("python", "print(1)"), title: "Run" },
    });
    expect(matchedEvents([scripted], "python")).toEqual([]);
    expect(matchedEvents([scripted], "print")).toEqual(["t1"]);
  });

  it("keeps searching past a call whose view an argument can't fill in", () => {
    const unfillable = testToolEvent({
      uuid: "t1",
      function: "open_file",
      arguments: { path: { toString: "medlar" } },
      view: {
        title: "Open {{path}}",
        format: "markdown",
        content: "Reading {{path}}",
      },
    });
    expect(matchedEvents([unfillable, second], "Done")).toEqual(["m2"]);
  });

  // A bridge may run a call under a new id and record the model's own id for it.
  const renamedRun = testToolEvent({
    uuid: "t1",
    id: "scaffold-1",
    function: "bash",
    arguments: args,
    metadata: { bridge: { proposal_id: call.id } },
  });

  it("leaves a call a bridge renamed to its tool event", () => {
    const events = [
      first,
      testApprovalEvent({ execution_id: "run-1" }),
      renamedRun,
    ];
    expect(matchedEvents(events, "persimmon")).toEqual(["t1"]);
  });

  // Hiding Approval events takes them out of the events Find searches, but
  // the panels still pair calls by the execution ids the whole log records.
  it("pairs a renamed call as the unfiltered log does", () => {
    const matches = findAllMatches(
      [first, renamedRun],
      "persimmon",
      rows,
      true
    );
    expect(matches.map((match) => match.eventId)).toEqual(["t1"]);
  });
});
