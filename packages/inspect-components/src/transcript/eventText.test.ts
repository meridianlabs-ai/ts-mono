import { describe, expect, it } from "vitest";

import type {
  CompactionEvent,
  ContentImage,
  ContentReasoning,
  ContentToolUse,
  ModelEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { eventsToStr } from "./eventText";

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
