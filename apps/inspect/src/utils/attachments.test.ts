import { describe, expect, it, vi } from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testCommunicationEvent,
  testInfoEvent,
  testModelCall,
  testModelEvent,
  testModelOutput,
  testSampleInitEvent,
  testScore,
  testScoreEvent,
  testStateEvent,
  testStoreEvent,
  testSubtaskEvent,
  testSwarmEvent,
  testToolCall,
  testToolEvent,
  testUserMessage,
} from "@tsmono/inspect-common/testing";
import type {
  ContentImage,
  ContentText,
  Event,
} from "@tsmono/inspect-common/types";

import {
  resolveEventAttachments,
  resolveInputAttachments,
  resolveMessageAttachments,
} from "./attachments";

const attachments = { abc123: "resolved content" };

// A position inspect_ai resolves, to exercise the ref parsing itself
const resolveText = (
  content: string,
  map: Readonly<Record<string, unknown>> = attachments,
  onFailedResolve?: (attachmentId: string) => void
) =>
  resolveMessageAttachments(testUserMessage({ content }), map, onFailedResolve)
    .content;

describe("attachment refs", () => {
  it("resolves attachment:// and legacy tc:// refs", () => {
    expect(resolveText("attachment://abc123")).toBe("resolved content");
    expect(resolveText("tc://abc123")).toBe("resolved content");
  });

  it.each(["attachment://nope", "tc://nope"])(
    "keeps %s as written on a miss and reports it",
    (ref) => {
      const onFailedResolve = vi.fn();
      expect(resolveText(ref, attachments, onFailedResolve)).toBe(ref);
      expect(onFailedResolve).toHaveBeenCalledWith("nope");
    }
  );

  it("preserves identity when nothing resolves, and of unchanged subtrees", () => {
    const plain = testUserMessage({ content: "plain" });
    expect(resolveMessageAttachments(plain, attachments)).toBe(plain);
    const messages = [
      plain,
      testUserMessage({ content: "attachment://abc123" }),
    ];
    const resolved = resolveMessageAttachments(messages, attachments);
    expect(resolved).not.toBe(messages);
    expect(resolved[0]).toBe(plain);
  });

  it("passes null and undefined through", () => {
    expect(resolveEventAttachments(null, attachments)).toBeNull();
    expect(resolveInputAttachments(undefined, attachments)).toBeUndefined();
  });
});

// Attachment ids are the suffix of a log-authored string; one that names an
// Object.prototype member is a miss, never the inherited builtin.
describe("attachment refs with prototype-named ids", () => {
  it.each([
    "constructor",
    "__proto__",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ])("treats attachment://%s as a miss", (id) => {
    const onFailedResolve = vi.fn();
    const ref = `attachment://${id}`;
    expect(resolveText(ref, attachments, onFailedResolve)).toBe(ref);
    expect(onFailedResolve).toHaveBeenCalledWith(id);
  });

  it("resolves an own attachment stored under such an id", () => {
    expect(
      resolveText("attachment://constructor", { constructor: "own content" })
    ).toBe("own content");
  });

  it("ignores attachments planted on Object.prototype", () => {
    Object.defineProperty(Object.prototype, "planted_attachment", {
      value: "polluted",
      configurable: true,
      writable: true,
    });
    try {
      expect(resolveText("attachment://planted_attachment")).toBe(
        "attachment://planted_attachment"
      );
    } finally {
      Reflect.deleteProperty(Object.prototype, "planted_attachment");
    }
  });
});

describe.each(["attachment://", "tc://"])(
  "%s attachment value validation",
  (protocol) => {
    it.each([
      { name: "object", value: { invalid: true } },
      { name: "array", value: ["invalid"] },
      { name: "null", value: null },
      { name: "number", value: 42 },
      { name: "boolean", value: false },
      { name: "undefined", value: undefined },
    ])("treats an own $name value as a miss", ({ value }) => {
      const onFailedResolve = vi.fn();
      const message = testUserMessage({ content: `${protocol}constructor` });

      expect(
        resolveMessageAttachments(
          message,
          { constructor: value },
          onFailedResolve
        )
      ).toBe(message);
      expect(onFailedResolve).toHaveBeenCalledExactlyOnceWith("constructor");
    });

    it.each(["constructor", "__proto__", "toString"])(
      "resolves an own empty string under %s",
      (id) => {
        const onFailedResolve = vi.fn();
        expect(
          resolveText(`${protocol}${id}`, { [id]: "" }, onFailedResolve)
        ).toBe("");
        expect(onFailedResolve).not.toHaveBeenCalled();
      }
    );
  }
);

// The resolver follows inspect_ai's typed walkers (log/_condense.py): only
// the positions its writer condenses resolve, and every other field is plain
// text shown as stored.
describe.each(["attachment://", "tc://"])("%s positions", (protocol) => {
  const ref = `${protocol}abc123`;
  const text = (value: string) =>
    ({ type: "text", text: value }) satisfies ContentText;
  const image = (value: string) =>
    ({ type: "image", image: value, detail: "auto" }) satisfies ContentImage;
  const assistantWithToolCall = (value: string) =>
    testAssistantMessage({
      content: [text(value)],
      tool_calls: [
        testToolCall({
          arguments: { cmd: value },
          view: { content: value, format: "text" },
        }),
      ],
    });

  it("leaves a string sample input as written", () => {
    expect(resolveInputAttachments(ref, attachments)).toBe(ref);
  });

  it.each<{ name: string; event: Event }>([
    {
      name: "a score explanation",
      event: testScoreEvent({ score: testScore({ explanation: ref }) }),
    },
    {
      name: "a model event's metadata",
      event: testModelEvent({ metadata: { note: ref } }),
    },
    {
      name: "an info event's metadata",
      event: testInfoEvent({ metadata: { note: ref } }),
    },
    {
      name: "a stored completion that differs from the first choice",
      event: testModelEvent({
        output: testModelOutput({
          completion: ref,
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({ content: "model text" }),
            }),
          ],
        }),
      }),
    },
  ])("leaves $name as written", ({ event }) => {
    expect(resolveEventAttachments(event, attachments)).toBe(event);
  });

  it("resolves message-list input and an assistant's tool calls", () => {
    expect(
      resolveInputAttachments(
        [testUserMessage({ content: ref }), assistantWithToolCall(ref)],
        attachments
      )
    ).toEqual([
      testUserMessage({ content: "resolved content" }),
      assistantWithToolCall("resolved content"),
    ]);
  });

  it("resolves a model event's input, choices, derived completion and call", () => {
    const modelEvent = (value: string, completion: string) =>
      testModelEvent({
        tools: [
          {
            name: "t",
            description: value,
            parameters: { type: "object", properties: {}, required: [] },
          },
        ],
        input: [testUserMessage({ content: value })],
        output: testModelOutput({
          completion,
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({ content: value }),
            }),
          ],
        }),
        call: testModelCall({ request: { p: value }, response: { r: value } }),
      });
    expect(resolveEventAttachments(modelEvent(ref, ref), attachments)).toEqual(
      modelEvent("resolved content", "resolved content")
    );
  });

  // inspect_ai stores text that begins with a ref prefix as an attachment of
  // its own; one pass reads it back as written, not as the attachment it names
  it("resolves an escaped literal ref once", () => {
    const escaped = { ...attachments, lit: ref };
    const modelEvent = (value: string) =>
      testModelEvent({
        input: [testAssistantMessage({ content: value })],
        output: testModelOutput({
          choices: [
            testChatCompletionChoice({
              message: testAssistantMessage({ content: value }),
            }),
          ],
        }),
        call: testModelCall({
          request: { messages: [{ content: value }] },
          response: { r: value },
        }),
      });
    expect(
      resolveEventAttachments(modelEvent("attachment://lit"), escaped)
    ).toEqual(modelEvent(ref));
  });

  it.each<{ name: string; event: (value: string) => Event }>([
    {
      name: "tool arguments and result media",
      event: (value) =>
        testToolEvent({
          arguments: { cmd: value },
          result: [text(ref), image(value)],
        }),
    },
    {
      name: "state and store changes",
      event: (value) =>
        testSubtaskEvent({
          events: [
            testStateEvent({
              changes: [
                { op: "add", path: "/a", value: { v: value }, replaced: null },
              ],
            }),
            testStoreEvent({
              changes: [{ op: "add", path: "/a", value, replaced: null }],
            }),
          ],
        }),
    },
    {
      name: "sample init input and state",
      event: (value) =>
        testSampleInitEvent({
          sample: { input: value, target: ref },
          state: { s: value },
        }),
    },
    {
      name: "info data",
      event: (value) => testInfoEvent({ data: { d: [value] } }),
    },
    {
      name: "communication record, rejection and data",
      event: (value) =>
        testCommunicationEvent({
          send: {
            record: {
              content: value,
              kind: "message",
              recipients: [],
              sender: "a",
              to: [],
            },
            rejected: { control: "c", reason: value },
          },
          data: { d: value },
        }),
    },
    {
      name: "swarm data",
      event: (value) => testSwarmEvent({ data: { d: value } }),
    },
  ])("resolves $name", ({ event }) => {
    expect(resolveEventAttachments(event(ref), attachments)).toEqual(
      event("resolved content")
    );
  });

  it.each([
    { name: "a string", result: ref },
    { name: "a single ContentText", result: text(ref) },
    { name: "a list", result: [text(ref), text("plain")] },
  ])("leaves tool result text in $name as written", ({ result }) => {
    const event = testToolEvent({ result });
    expect(resolveEventAttachments(event, attachments).result).toEqual(result);
  });

  it("resolves a single tool result image", () => {
    expect(
      resolveEventAttachments(
        testToolEvent({ result: image(ref) }),
        attachments
      ).result
    ).toEqual(image("resolved content"));
  });

  it.each([
    {
      name: "subtask",
      parent: (events: unknown[]) => testSubtaskEvent({ events }),
    },
    {
      name: "tool",
      parent: (events: unknown[]) => testToolEvent({ id: "parent", events }),
    },
  ])(
    "applies to lists of events and to events nested in a $name",
    ({ parent }) => {
      // Nested tool results were never condensed, media included
      const tool = testToolEvent({
        result: [image(ref)],
        arguments: { cmd: ref },
      });
      const outer = parent([tool]);
      expect(resolveEventAttachments([outer], attachments)).toEqual([
        {
          ...outer,
          events: [{ ...tool, arguments: { cmd: "resolved content" } }],
        },
      ]);
    }
  );
});
