import { describe, expect, it, test } from "vitest";

import type {
  CompactionEvent,
  ContentImage,
  ContentReasoning,
  ContentToolUse,
  ModelEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { eventSearchText, eventsToStr } from "./eventText";
import { EventNode } from "./types";

const reasoning = (r: Partial<ContentReasoning>): ContentReasoning => ({
  type: "reasoning",
  reasoning: "",
  redacted: false,
  ...r,
});

const modelEventWith = (
  content: ModelEvent["output"]["choices"][number]["message"]["content"]
): ModelEvent =>
  ({
    event: "model",
    uuid: "u",
    span_id: null,
    timestamp: "2026-04-29T00:00:00Z",
    working_start: 0,
    pending: false,
    model: "test/model",
    role: null,
    input: [],
    tools: [],
    tool_choice: null,
    config: {},
    output: {
      model: "test/model",
      choices: [
        {
          message: {
            role: "assistant",
            content,
            source: "generate",
          },
          stop_reason: "stop",
        },
      ],
      usage: null,
    },
    error: null,
    cache: null,
    call: null,
    completed: null,
    working_time: null,
    style: null,
    metadata: null,
  }) as unknown as ModelEvent;

describe("eventsToStr — reasoning content", () => {
  it("uses summary when redacted (Anthropic ≥4, OpenAI encrypted)", () => {
    const out = eventsToStr([
      modelEventWith([
        reasoning({
          reasoning: "OPAQUE_SIGNATURE_BLOB",
          summary: "Reading the instructions.",
          redacted: true,
        }),
      ]),
    ]);
    expect(out).toContain("Reading the instructions.");
    expect(out).not.toContain("OPAQUE_SIGNATURE_BLOB");
  });

  it("falls back to summary when reasoning is empty", () => {
    const out = eventsToStr([
      modelEventWith([
        reasoning({
          reasoning: "",
          summary: "Step-by-step plan.",
          redacted: false,
        }),
      ]),
    ]);
    expect(out).toContain("Step-by-step plan.");
  });

  it("uses reasoning when present and not redacted", () => {
    const out = eventsToStr([
      modelEventWith([
        reasoning({
          reasoning: "Full chain of thought.",
          summary: null,
          redacted: false,
        }),
      ]),
    ]);
    expect(out).toContain("Full chain of thought.");
  });

  it("emits no reasoning text when redacted and no summary (signature must not leak)", () => {
    const out = eventsToStr([
      modelEventWith([
        reasoning({
          reasoning: "OPAQUE_SIGNATURE_BLOB",
          summary: null,
          redacted: true,
        }),
      ]),
    ]);
    expect(out).not.toContain("OPAQUE_SIGNATURE_BLOB");
  });

  it("emits no reasoning text when redacted and summary is empty string", () => {
    const out = eventsToStr([
      modelEventWith([
        reasoning({
          reasoning: "OPAQUE_SIGNATURE_BLOB",
          summary: "",
          redacted: true,
        }),
      ]),
    ]);
    expect(out).not.toContain("OPAQUE_SIGNATURE_BLOB");
  });
});

describe("eventsToStr — tool_use content", () => {
  it("includes result and error text for tool_use blocks", () => {
    const toolUse: ContentToolUse = {
      type: "tool_use",
      id: "tu-1",
      name: "search",
      arguments: '{"q":"hi"}',
      result: "Found 3 hits",
      error: "rate-limited",
      caller: { type: "direct" },
    } as unknown as ContentToolUse;
    const out = eventsToStr([modelEventWith([toolUse])]);
    expect(out).toContain("search");
    expect(out).toContain("Found 3 hits");
    expect(out).toContain("rate-limited");
  });
});

describe("eventsToStr — multimodal content placeholders", () => {
  const data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA_LONG_BLOB_";
  const image: ContentImage = {
    type: "image",
    image: data,
    detail: null,
  } as unknown as ContentImage;

  it("emits <image /> placeholder, no base64 leak", () => {
    const out = eventsToStr([modelEventWith([image])]);
    expect(out).toContain("<image />");
    expect(out).not.toContain("_LONG_BLOB_");
  });

  it("emits placeholders for audio/video/data/document", () => {
    const out = eventsToStr([
      modelEventWith([
        { type: "audio", audio: "data:audio/mp3;base64,_AUDIO_BLOB_" } as never,
        { type: "video", video: "data:video/mp4;base64,_VIDEO_BLOB_" } as never,
        { type: "data", data: { huge: "_DATA_BLOB_" } } as never,
        { type: "document", document: "_DOC_BLOB_" } as never,
      ]),
    ]);
    expect(out).toContain("<audio />");
    expect(out).toContain("<video />");
    expect(out).toContain("<data />");
    expect(out).toContain("<document />");
    expect(out).not.toContain("_AUDIO_BLOB_");
    expect(out).not.toContain("_VIDEO_BLOB_");
    expect(out).not.toContain("_DATA_BLOB_");
    expect(out).not.toContain("_DOC_BLOB_");
  });
});

// sanitizeStringify isn't exported; exercised here via state events, whose
// `value` field is routed through the helper.
describe("eventsToStr — sanitizeStringify (via state events)", () => {
  const stateEvent = (value: unknown) =>
    ({
      event: "state",
      uuid: "s",
      span_id: null,
      timestamp: "2026-04-29T00:00:00Z",
      working_start: 0,
      changes: [{ op: "replace", path: "/x", value }],
    }) as unknown as Parameters<typeof eventsToStr>[0][number];

  it("redacts ContentReasoning to summary when redacted", () => {
    const out = eventsToStr([
      stateEvent({
        type: "reasoning",
        reasoning: "OPAQUE_SIGNATURE",
        summary: "human readable",
        redacted: true,
      }),
    ]);
    expect(out).toContain("human readable");
    expect(out).not.toContain("OPAQUE_SIGNATURE");
  });

  it("replaces ContentImage with placeholder", () => {
    const out = eventsToStr([
      stateEvent({
        type: "image",
        image: "data:image/png;base64,_BIG_BLOB_",
      }),
    ]);
    expect(out).toContain("<image />");
    expect(out).not.toContain('"<image />"'); // placeholder must not be double-quoted
    expect(out).not.toContain("_BIG_BLOB_");
  });

  it("preserves primitives and plain records", () => {
    const out = eventsToStr([
      stateEvent({ count: 3, label: "hello", nested: [1, 2, "x"] }),
    ]);
    expect(out).toContain('"count":3');
    expect(out).toContain('"label":"hello"');
    expect(out).toContain('"nested":[1,2,"x"]');
  });

  it("walks nested content arrays", () => {
    const out = eventsToStr([
      stateEvent({
        messages: [
          {
            content: [
              { type: "image", image: "data:_BIG_" },
              { type: "text", text: "ok" },
            ],
          },
        ],
      }),
    ]);
    expect(out).toContain("<image />");
    expect(out).toContain('"text":"ok"');
    expect(out).not.toContain("_BIG_");
  });

  it("does not collapse user data with a colliding `type` discriminator", () => {
    const out = eventsToStr([
      stateEvent({
        type: "image",
        url: "https://example.com/diagram.svg",
        label: "fig 1",
      }),
    ]);
    expect(out).not.toContain("<image />");
    expect(out).toContain("https://example.com/diagram.svg");
    expect(out).toContain("fig 1");
  });
});

const toolEvent = (result: unknown): ToolEvent =>
  ({
    event: "tool",
    uuid: "t",
    span_id: null,
    timestamp: "2026-04-29T00:00:00Z",
    working_start: 0,
    pending: false,
    function: "view_image",
    arguments: { path: "/foo.png" },
    result,
    truncated: null,
    view: null,
    error: null,
    events: [],
    completed: null,
    working_time: null,
    agent: null,
    failed: null,
    metadata: null,
  }) as unknown as ToolEvent;

describe("eventsToStr — extractEventFields sanitization", () => {
  it("sanitizes tool result containing image content", () => {
    const out = eventsToStr([
      toolEvent([
        { type: "image", image: "data:image/png;base64,_HUGE_PNG_" },
        { type: "text", text: "see image" },
      ]),
    ]);
    expect(out).toContain("<image />");
    expect(out).toContain("see image");
    expect(out).not.toContain("_HUGE_PNG_");
  });
});

const compactionEvent = (
  partial: Partial<CompactionEvent> = {}
): CompactionEvent =>
  ({
    event: "compaction",
    uuid: "VYVv8bWPCmD5fJYzrYq5MT",
    span_id: "SPJ9XpwBYA3GuLzkGwmdwR",
    timestamp: "2026-04-25T03:12:30.042596+00:00",
    working_start: 4195.599,
    source: "inspect",
    type: "summary",
    tokens_before: 263089,
    tokens_after: 1923,
    metadata: {
      strategy: "CompactionSummary",
      messages_before: 190,
      messages_after: 3,
    },
    ...partial,
  }) as unknown as CompactionEvent;

describe("eventsToStr — compaction event", () => {
  it("renders only UI-visible fields (tokens + metadata), not full event JSON", () => {
    const out = eventsToStr([compactionEvent()]);
    expect(out).toContain("tokens_before");
    expect(out).toContain("263089");
    expect(out).toContain("tokens_after");
    expect(out).toContain("1923");
    expect(out).toContain("strategy");
    expect(out).toContain("CompactionSummary");
    expect(out).toContain("messages_before");
    expect(out).toContain("190");
    expect(out).not.toContain("VYVv8bWPCmD5fJYzrYq5MT"); // uuid
    expect(out).not.toContain("SPJ9XpwBYA3GuLzkGwmdwR"); // span_id
    expect(out).not.toContain("working_start");
    expect(out).not.toContain('"event":"compaction"'); // discriminator inside JSON dump
  });

  it("omits source when it is the default 'inspect'", () => {
    const out = eventsToStr([compactionEvent({ source: "inspect" })]);
    expect(out).not.toMatch(/^source: /m);
  });

  it("includes source when it is non-default", () => {
    const out = eventsToStr([compactionEvent({ source: "agent" })]);
    expect(out).toContain("source: agent");
  });
});

const makeNode = (event: Record<string, unknown>): EventNode => {
  return new EventNode("test-id", event as never, 0);
};

describe("eventSearchText", () => {
  test("score: includes answer, explanation, and value", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score",
        score: { answer: "yes", explanation: "partial", value: 0.5 },
        target: "correct answer",
        intermediate: true,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("yes");
    expect(texts).toContain("partial");
    expect(texts).toContain("0.5");
    expect(texts).toContain("correct answer");
  });

  test("score: includes array target", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score",
        score: { answer: null, explanation: null, value: 1 },
        target: ["a", "b"],
        intermediate: false,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("a");
    expect(texts).toContain("b");
  });

  test("score_edit: includes score_name and edit fields", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score_edit",
        score_name: "accuracy",
        edit: {
          answer: "new answer",
          explanation: "fixed reasoning",
          provenance: null,
        },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("accuracy");
    expect(texts).toContain("new answer");
    expect(texts).toContain("fixed reasoning");
  });

  test("score_edit: excludes UNCHANGED fields", () => {
    const texts = eventSearchText(
      makeNode({
        event: "score_edit",
        score_name: "accuracy",
        edit: {
          answer: "UNCHANGED",
          explanation: "UNCHANGED",
          provenance: null,
        },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("accuracy");
    expect(texts).not.toContain("UNCHANGED");
  });

  test("sample_init: includes target and metadata", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sample_init",
        sample: {
          target: "expected output",
          metadata: { category: "math" },
          input: "question",
        },
        state: {},
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("expected output");
    expect(texts.some((t) => t.includes("math"))).toBe(true);
  });

  test("sample_limit: includes message and type", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sample_limit",
        message: "Token limit exceeded",
        type: "token",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("Token limit exceeded");
    expect(texts).toContain("token");
  });

  test("input: includes input text", () => {
    const texts = eventSearchText(
      makeNode({
        event: "input",
        input: "user typed this",
        input_ansi: "user typed this",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("user typed this");
  });

  test("approval: includes decision, explanation, and approver", () => {
    const texts = eventSearchText(
      makeNode({
        event: "approval",
        decision: "approve",
        explanation: "looks safe",
        approver: "human-in-loop",
        message: "Allow file write?",
        call: {},
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("approve");
    expect(texts).toContain("looks safe");
    expect(texts).toContain("human-in-loop");
  });

  test("sandbox: includes action, cmd, output, and file", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sandbox",
        action: "exec",
        cmd: "ls -la",
        output: "total 42",
        file: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("exec");
    expect(texts).toContain("ls -la");
    expect(texts).toContain("total 42");
  });

  test("sandbox: includes file for read/write actions", () => {
    const texts = eventSearchText(
      makeNode({
        event: "sandbox",
        action: "read_file",
        cmd: null,
        output: "file contents",
        file: "/tmp/test.txt",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("read_file");
    expect(texts).toContain("/tmp/test.txt");
  });

  test("state: includes change paths and values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "state",
        changes: [
          { op: "replace", path: "/messages/0/content", value: "hello" },
          { op: "add", path: "/count", value: 42 },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("/messages/0/content");
    expect(texts).toContain("hello");
    expect(texts).toContain("/count");
    expect(texts).toContain("42");
  });

  test("store: includes change paths and values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "store",
        changes: [{ op: "add", path: "/key", value: "val" }],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("/key");
    expect(texts).toContain("val");
  });

  test("model: includes model name", () => {
    const texts = eventSearchText(
      makeNode({
        event: "model",
        model: "gpt-4",
        role: "assistant",
        output: { choices: [] },
        input: [],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("gpt-4");
  });

  test("model: extracts text from output choices", () => {
    const texts = eventSearchText(
      makeNode({
        event: "model",
        model: "gpt-4",
        role: null,
        output: {
          choices: [{ message: { content: "hello world", role: "assistant" } }],
        },
        input: [],
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("gpt-4");
    expect(texts).toContain("hello world");
  });

  test("step: includes name and type as separate values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "step",
        name: "generate",
        type: "solver",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("generate");
    expect(texts).toContain("solver");
  });

  test("step: includes name when no type", () => {
    const texts = eventSearchText(
      makeNode({
        event: "step",
        name: "my_step",
        type: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("my_step");
  });

  test("subtask: includes name and type", () => {
    const fork = eventSearchText(
      makeNode({
        event: "subtask",
        name: "parallel",
        type: "fork",
        input: null,
        result: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(fork).toContain("parallel");
    expect(fork).toContain("fork");

    const sub = eventSearchText(
      makeNode({
        event: "subtask",
        name: "check",
        type: "subtask",
        input: null,
        result: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(sub).toContain("check");
    expect(sub).toContain("subtask");
  });

  test("tool: includes view title and function name", () => {
    const texts = eventSearchText(
      makeNode({
        event: "tool",
        function: "search",
        view: { title: "Web Search" },
        arguments: null,
        result: null,
        error: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("Web Search");
    expect(texts).toContain("search");
  });

  test("error: includes error message", () => {
    const texts = eventSearchText(
      makeNode({
        event: "error",
        error: { message: "something broke", traceback: null },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("something broke");
  });

  test("logger: includes message and filename", () => {
    const texts = eventSearchText(
      makeNode({
        event: "logger",
        message: {
          level: "WARNING",
          message: "disk space low",
          filename: "main.py",
        },
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("disk space low");
    expect(texts).toContain("main.py");
  });

  test("info: includes source and data", () => {
    const texts = eventSearchText(
      makeNode({
        event: "info",
        source: "system",
        data: "startup complete",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("system");
    expect(texts).toContain("startup complete");
  });

  test("info: includes data without source", () => {
    const texts = eventSearchText(
      makeNode({
        event: "info",
        source: null,
        data: "startup complete",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("startup complete");
  });

  test("span_begin: includes name and type as separate values", () => {
    const texts = eventSearchText(
      makeNode({
        event: "span_begin",
        name: "evaluate",
        type: "solver",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("evaluate");
    expect(texts).toContain("solver");
  });

  test("span_begin: includes name when no type", () => {
    const texts = eventSearchText(
      makeNode({
        event: "span_begin",
        name: "init",
        type: null,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("init");
  });

  test("compaction: emits tokens and omits default 'inspect' source", () => {
    const texts = eventSearchText(
      makeNode({
        event: "compaction",
        source: "inspect",
        tokens_before: 1000,
        tokens_after: 500,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("1000");
    expect(texts).toContain("500");
    expect(texts).not.toContain("inspect");
  });

  test("compaction: includes non-default source", () => {
    const texts = eventSearchText(
      makeNode({
        event: "compaction",
        source: "agent",
        tokens_before: 1000,
        tokens_after: 500,
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toContain("agent");
  });

  test("unknown event: returns empty array", () => {
    const texts = eventSearchText(
      makeNode({
        event: "span_end",
        timestamp: "2024-01-01T00:00:00Z",
      })
    );
    expect(texts).toEqual([]);
  });
});
