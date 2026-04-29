import { describe, expect, it } from "vitest";

import type {
  ContentReasoning,
  ModelEvent,
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
