import { describe, expect, it, test } from "vitest";

import {
  testApprovalEvent,
  testAssistantMessage,
  testChatCompletionChoice,
  testCompactionEvent,
  testErrorEvent,
  testEvalError,
  testInfoEvent,
  testInputEvent,
  testInterruptEvent,
  testLoggerEvent,
  testModelEvent,
  testModelOutput,
  testSampleInitEvent,
  testSampleLimitEvent,
  testSandboxEvent,
  testScore,
  testScoreEdit,
  testScoreEditEvent,
  testScoreEvent,
  testSpanBeginEvent,
  testSpanEndEvent,
  testStateEvent,
  testStepEvent,
  testStoreEvent,
  testSubtaskEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type {
  CompactionEvent,
  ContentImage,
  ContentReasoning,
  ContentToolUse,
  Event,
  JsonValue,
  ModelEvent,
  StateEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { eventSearchText, eventsToStr, extractEventFields } from "./eventText";
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
  testModelEvent({
    uuid: "u",
    timestamp: "2026-04-29T00:00:00Z",
    model: "test/model",
    output: testModelOutput({
      model: "test/model",
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content, source: "generate" }),
        }),
      ],
    }),
  });

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
      tool_type: "web_search",
      id: "tu-1",
      name: "search",
      arguments: '{"q":"hi"}',
      result: "Found 3 hits",
      error: "rate-limited",
    };
    const out = eventsToStr([modelEventWith([toolUse])]);
    expect(out).toContain("search");
    expect(out).toContain("Found 3 hits");
    expect(out).toContain("rate-limited");
  });
});

describe("extractEventFields — model error / traceback", () => {
  it("includes the model event error and traceback in search text", () => {
    const node = new EventNode(
      "model-1",
      testModelEvent({
        model: "test/model",
        error: "API rate limit exceeded",
        traceback: "Traceback (most recent call last): ...",
      }),
      0
    );
    const texts = eventSearchText(node);
    expect(texts).toContain("API rate limit exceeded");
    expect(texts).toContain("Traceback (most recent call last): ...");
  });
});

describe("eventsToStr — multimodal content placeholders", () => {
  const data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA_LONG_BLOB_";
  const image: ContentImage = {
    type: "image",
    image: data,
    detail: "auto",
  };

  it("emits <image /> placeholder, no base64 leak", () => {
    const out = eventsToStr([modelEventWith([image])]);
    expect(out).toContain("<image />");
    expect(out).not.toContain("_LONG_BLOB_");
  });

  it("emits placeholders for audio/video/data/document", () => {
    const out = eventsToStr([
      modelEventWith([
        {
          type: "audio",
          audio: "data:audio/mp3;base64,_AUDIO_BLOB_",
          format: "mp3",
        },
        {
          type: "video",
          video: "data:video/mp4;base64,_VIDEO_BLOB_",
          format: "mp4",
        },
        { type: "data", data: { huge: "_DATA_BLOB_" } },
        {
          type: "document",
          document: "_DOC_BLOB_",
          filename: "doc.pdf",
          mime_type: "application/pdf",
          citations: false,
        },
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
  const stateEvent = (value: JsonValue): StateEvent =>
    testStateEvent({
      uuid: "s",
      timestamp: "2026-04-29T00:00:00Z",
      changes: [{ op: "replace", path: "/x", value, replaced: null }],
    });

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

const toolEvent = (result: ToolEvent["result"]): ToolEvent =>
  testToolEvent({
    uuid: "t",
    timestamp: "2026-04-29T00:00:00Z",
    function: "view_image",
    arguments: { path: "/foo.png" },
    result,
  });

describe("eventsToStr — extractEventFields sanitization", () => {
  it("walks a tool result array: text renders, data: image drops (no placeholder, no leak)", () => {
    const out = eventsToStr([
      toolEvent([
        {
          type: "image",
          image: "data:image/png;base64,_HUGE_PNG_",
          detail: "auto",
        },
        { type: "text", text: "see image" },
      ]),
    ]);
    expect(out).toContain("see image");
    expect(out).not.toContain("<image />");
    expect(out).not.toContain("_HUGE_PNG_");
  });
});

const compactionEvent = (
  partial: Partial<CompactionEvent> = {}
): CompactionEvent =>
  testCompactionEvent({
    uuid: "VYVv8bWPCmD5fJYzrYq5MT",
    span_id: "SPJ9XpwBYA3GuLzkGwmdwR",
    working_start: 4195.599,
    source: "inspect",
    tokens_before: 263089,
    tokens_after: 1923,
    metadata: {
      strategy: "CompactionSummary",
      messages_before: 190,
      messages_after: 3,
    },
    ...partial,
  });

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

const makeNode = (event: Event): EventNode =>
  new EventNode("test-id", event, 0);

/**
 * `extractToolResultText` takes `unknown` and must survive result shapes
 * the schema forbids (nested `tool` blocks, `data` parts, bare objects);
 * the cases that exercise that path opt in here, one at a time.
 */
const outOfContractResult = (value: unknown): ToolEvent["result"] =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- deliberately out of contract: see above
  value as ToolEvent["result"];

const toolView = (title: string): ToolEvent["view"] => ({
  title,
  content: "",
  format: "text",
});

describe("eventSearchText", () => {
  test("score: includes answer, explanation, and value", () => {
    const texts = eventSearchText(
      makeNode(
        testScoreEvent({
          score: testScore({
            answer: "yes",
            explanation: "partial",
            value: 0.5,
          }),
          target: "correct answer",
          intermediate: true,
        })
      )
    );
    expect(texts).toContain("yes");
    expect(texts).toContain("partial");
    expect(texts).toContain("0.5");
    expect(texts).toContain("correct answer");
  });

  test("score: includes array target", () => {
    const texts = eventSearchText(
      makeNode(
        testScoreEvent({
          score: testScore({ answer: null, explanation: null, value: 1 }),
          target: ["a", "b"],
          intermediate: false,
        })
      )
    );
    expect(texts).toContain("a");
    expect(texts).toContain("b");
  });

  test("score_edit: includes score_name and edit fields", () => {
    const texts = eventSearchText(
      makeNode(
        testScoreEditEvent({
          score_name: "accuracy",
          edit: testScoreEdit({
            answer: "new answer",
            explanation: "fixed reasoning",
            provenance: null,
          }),
        })
      )
    );
    expect(texts).toContain("accuracy");
    expect(texts).toContain("new answer");
    expect(texts).toContain("fixed reasoning");
  });

  test("score_edit: excludes UNCHANGED fields", () => {
    const texts = eventSearchText(
      makeNode(
        testScoreEditEvent({
          score_name: "accuracy",
          edit: testScoreEdit({
            answer: "UNCHANGED",
            explanation: "UNCHANGED",
            provenance: null,
          }),
        })
      )
    );
    expect(texts).toContain("accuracy");
    expect(texts).not.toContain("UNCHANGED");
  });

  test("sample_init: includes target and metadata", () => {
    const texts = eventSearchText(
      makeNode(
        testSampleInitEvent({
          sample: {
            target: "expected output",
            metadata: { category: "math" },
            input: "question",
          },
          state: {},
        })
      )
    );
    expect(texts).toContain("expected output");
    expect(texts.some((t) => t.includes("math"))).toBe(true);
  });

  test("sample_limit: includes message and type", () => {
    const texts = eventSearchText(
      makeNode(
        testSampleLimitEvent({ message: "Token limit exceeded", type: "token" })
      )
    );
    expect(texts).toContain("Token limit exceeded");
    expect(texts).toContain("token");
  });

  test("input: includes input text", () => {
    const texts = eventSearchText(
      makeNode(
        testInputEvent({
          input: "user typed this",
          input_ansi: "user typed this",
        })
      )
    );
    expect(texts).toContain("user typed this");
  });

  test("interrupt: includes source and interrupted, plus optional ids", () => {
    const texts = eventSearchText(
      makeNode(
        testInterruptEvent({
          source: "user_cancel",
          interrupted: "tool_call",
          interrupted_tool_call_id: "tc-xyz",
          interrupted_model_event_id: "me-abc",
        })
      )
    );
    expect(texts).toContain("user_cancel");
    expect(texts).toContain("tool_call");
    expect(texts).toContain("tc-xyz");
    expect(texts).toContain("me-abc");
  });

  test("interrupt: required fields only", () => {
    const texts = eventSearchText(
      makeNode(
        testInterruptEvent({ source: "limit", interrupted: "between_turns" })
      )
    );
    expect(texts).toContain("limit");
    expect(texts).toContain("between_turns");
    expect(texts).not.toContain("undefined");
  });

  test("approval: includes decision, explanation, and approver", () => {
    const texts = eventSearchText(
      makeNode(
        testApprovalEvent({
          decision: "approve",
          explanation: "looks safe",
          approver: "human-in-loop",
          message: "Allow file write?",
          call: testToolCall(),
        })
      )
    );
    expect(texts).toContain("approve");
    expect(texts).toContain("looks safe");
    expect(texts).toContain("human-in-loop");
  });

  test("sandbox: includes action, cmd, output, and file", () => {
    const texts = eventSearchText(
      makeNode(
        testSandboxEvent({
          action: "exec",
          cmd: "ls -la",
          output: "total 42",
          file: null,
        })
      )
    );
    expect(texts).toContain("exec");
    expect(texts).toContain("ls -la");
    expect(texts).toContain("total 42");
  });

  test("sandbox: includes file for read/write actions", () => {
    const texts = eventSearchText(
      makeNode(
        testSandboxEvent({
          action: "read_file",
          cmd: null,
          output: "file contents",
          file: "/tmp/test.txt",
        })
      )
    );
    expect(texts).toContain("read_file");
    expect(texts).toContain("/tmp/test.txt");
  });

  test("state: includes change paths and values", () => {
    const texts = eventSearchText(
      makeNode(
        testStateEvent({
          changes: [
            {
              op: "replace",
              path: "/messages/0/content",
              value: "hello",
              replaced: null,
            },
            { op: "add", path: "/count", value: 42, replaced: null },
          ],
        })
      )
    );
    expect(texts).toContain("/messages/0/content");
    expect(texts).toContain("hello");
    expect(texts).toContain("/count");
    expect(texts).toContain("42");
  });

  test("store: includes change paths and values", () => {
    const texts = eventSearchText(
      makeNode(
        testStoreEvent({
          changes: [{ op: "add", path: "/key", value: "val", replaced: null }],
        })
      )
    );
    expect(texts).toContain("/key");
    expect(texts).toContain("val");
  });

  test("model: includes model name", () => {
    const texts = eventSearchText(
      makeNode(testModelEvent({ model: "gpt-4", role: "assistant" }))
    );
    expect(texts).toContain("gpt-4");
  });

  test("model: extracts text from output choices", () => {
    const texts = eventSearchText(
      makeNode(
        testModelEvent({
          model: "gpt-4",
          role: null,
          output: testModelOutput({
            choices: [
              testChatCompletionChoice({
                message: testAssistantMessage({ content: "hello world" }),
              }),
            ],
          }),
        })
      )
    );
    expect(texts).toContain("gpt-4");
    expect(texts).toContain("hello world");
  });

  test("step: includes name and type as separate values", () => {
    const texts = eventSearchText(
      makeNode(testStepEvent({ name: "generate", type: "solver" }))
    );
    expect(texts).toContain("generate");
    expect(texts).toContain("solver");
  });

  test("step: includes name when no type", () => {
    const texts = eventSearchText(
      makeNode(testStepEvent({ name: "my_step", type: null }))
    );
    expect(texts).toContain("my_step");
  });

  test("subtask: includes name and type", () => {
    const fork = eventSearchText(
      makeNode(
        testSubtaskEvent({ name: "parallel", type: "fork", result: null })
      )
    );
    expect(fork).toContain("parallel");
    expect(fork).toContain("fork");

    const sub = eventSearchText(
      makeNode(
        testSubtaskEvent({ name: "check", type: "subtask", result: null })
      )
    );
    expect(sub).toContain("check");
    expect(sub).toContain("subtask");
  });

  test("tool: includes view title and function name", () => {
    const texts = eventSearchText(
      makeNode(
        testToolEvent({
          function: "search",
          view: toolView("Web Search"),
          error: null,
        })
      )
    );
    expect(texts).toContain("Web Search");
    expect(texts).toContain("search");
  });

  test("tool: array result yields one ordered search segment per rendered block", () => {
    const node = makeNode(
      testToolEvent({
        function: "browser",
        view: toolView("Browser"),
        arguments: { action: "get_page_text" },
        result: outOfContractResult([
          { type: "text", text: "Revenue Recognition in policy docs" },
          {
            type: "tool",
            content: [
              { type: "text", text: "Revenue Recognition in extracted page" },
            ],
          },
          { type: "image", image: "data:image/png;base64,abc123" },
        ]),
        error: null,
      })
    );

    const resultSegments = extractEventFields(node.event)
      .filter(([key]) => key === "result")
      .map(([, value]) => value);
    expect(resultSegments).toEqual([
      "Revenue Recognition in policy docs",
      "Revenue Recognition in extracted page",
    ]);

    const texts = eventSearchText(node);
    expect(texts).toContain('{"action":"get_page_text"}');
    expect(texts.join("\n")).not.toContain("data:image/png;base64");
  });

  test("tool: array document renders its filename; audio/video render no text", () => {
    const node = makeNode(
      testToolEvent({
        function: "fetch",
        result: [
          {
            type: "document",
            filename: "report.pdf",
            document: "data:application/pdf;base64,_DOC_BLOB_",
            mime_type: "application/pdf",
            citations: false,
          },
          {
            type: "audio",
            audio: "data:audio/mp3;base64,_AUDIO_BLOB_",
            format: "mp3",
          },
          {
            type: "video",
            video: "data:video/mp4;base64,_VIDEO_BLOB_",
            format: "mp4",
          },
        ],
        error: null,
      })
    );
    const resultSegments = extractEventFields(node.event)
      .filter(([key]) => key === "result")
      .map(([, value]) => value);
    expect(resultSegments).toEqual(["report.pdf"]);
    const joined = resultSegments.join("\n");
    expect(joined).not.toContain("_AUDIO_BLOB_");
    expect(joined).not.toContain("_VIDEO_BLOB_");
    expect(joined).not.toContain("_DOC_BLOB_");
  });

  test("tool: excluded hard cases stay safe (no payload leak), not renderer-exact", () => {
    const imageNode = makeNode(
      testToolEvent({
        function: "view_image",
        result: {
          type: "image",
          image: "data:image/png;base64,_HUGE_BLOB_",
          detail: "auto",
        },
        error: null,
      })
    );
    expect(eventSearchText(imageNode).join("\n")).not.toContain("_HUGE_BLOB_");

    const dataNode = makeNode(
      testToolEvent({
        function: "fetch",
        result: outOfContractResult([
          { type: "data", data: { secret: "_DATA_VALUE_" } },
        ]),
        error: null,
      })
    );
    expect(eventSearchText(dataNode).join("\n")).not.toContain("_DATA_VALUE_");

    const objectNode = makeNode(
      testToolEvent({
        function: "calc",
        result: outOfContractResult({ answer: 42, label: "ok" }),
        error: null,
      })
    );
    const objectSegments = extractEventFields(objectNode.event)
      .filter(([key]) => key === "result")
      .map(([, value]) => value);
    expect(objectSegments).toEqual(['{"answer":42,"label":"ok"}']);
  });

  test("error: includes error message", () => {
    const texts = eventSearchText(
      makeNode(
        testErrorEvent({ error: testEvalError({ message: "something broke" }) })
      )
    );
    expect(texts).toContain("something broke");
  });

  test("logger: includes message and filename", () => {
    const texts = eventSearchText(
      makeNode(
        testLoggerEvent({
          message: {
            level: "warning",
            message: "disk space low",
            filename: "main.py",
            created: 0,
            module: "main",
            lineno: 1,
          },
        })
      )
    );
    expect(texts).toContain("disk space low");
    expect(texts).toContain("main.py");
  });

  test("info: includes source and data", () => {
    const texts = eventSearchText(
      makeNode(testInfoEvent({ source: "system", data: "startup complete" }))
    );
    expect(texts).toContain("system");
    expect(texts).toContain("startup complete");
  });

  test("info: includes data without source", () => {
    const texts = eventSearchText(
      makeNode(testInfoEvent({ source: null, data: "startup complete" }))
    );
    expect(texts).toContain("startup complete");
  });

  test("span_begin: includes name and type as separate values", () => {
    const texts = eventSearchText(
      makeNode(testSpanBeginEvent({ name: "evaluate", type: "solver" }))
    );
    expect(texts).toContain("evaluate");
    expect(texts).toContain("solver");
  });

  test("span_begin: includes name when no type", () => {
    const texts = eventSearchText(
      makeNode(testSpanBeginEvent({ name: "init", type: null }))
    );
    expect(texts).toContain("init");
  });

  test("compaction: emits tokens and omits default 'inspect' source", () => {
    const texts = eventSearchText(
      makeNode(
        testCompactionEvent({
          source: "inspect",
          tokens_before: 1000,
          tokens_after: 500,
        })
      )
    );
    expect(texts).toContain("1000");
    expect(texts).toContain("500");
    expect(texts).not.toContain("inspect");
  });

  test("compaction: includes non-default source", () => {
    const texts = eventSearchText(
      makeNode(
        testCompactionEvent({
          source: "agent",
          tokens_before: 1000,
          tokens_after: 500,
        })
      )
    );
    expect(texts).toContain("agent");
  });

  test("unknown event: returns empty array", () => {
    const texts = eventSearchText(makeNode(testSpanEndEvent()));
    expect(texts).toEqual([]);
  });
});
