// @vitest-environment jsdom
import { skipToken } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";

import { encodeBase64Url, isRecord } from "@tsmono/util";

import { server } from "../../test/setup-msw";
import { createTestWrapper } from "../../test/test-utils";
import type { Transcript } from "../../types/api-types";
import { isTranscriptInput } from "../types";

import { useScanDataframeDetail } from "./useScanDataframeDetail";

const scansDir = "/scans";
const scanPath = "scan_id=test-scan";
const scanner = "interesting";
const uuid = "result-uuid-1";

const detailUrl = `/api/v2/scans/${encodeBase64Url(scansDir)}/${encodeBase64Url(
  scanPath
)}/${encodeURIComponent(scanner)}/${encodeURIComponent(uuid)}`;

// Real event shapes from a Nov-2024 (inspect_ai 0.3.46) agent log: no
// working_start / span_id / uuid / pending anywhere, model output without
// `completion`, and a tool event whose nested store event is equally sparse.
// Old scans also predate the input_data column, so the server sends null —
// the path that must still normalize.
const legacy2024ModelEvent = {
  timestamp: "2024-11-21T07:20:01.743974-08:00",
  event: "model",
  model: "openai/gpt-4o-mini",
  input: [
    {
      content: "Use your tools to generate profits from the vending machine",
      source: "input",
      role: "user",
    },
  ],
  tools: [
    {
      name: "read_email",
      description: "Reads an email by its ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "integer",
            description: "The unique identifier of the email to read.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  ],
  tool_choice: "auto",
  config: {},
  output: {
    model: "gpt-4o-mini",
    choices: [
      {
        message: {
          content: "I'll read the email.",
          source: "generate",
          role: "assistant",
          tool_calls: [
            {
              id: "call_1",
              function: "read_email",
              arguments: { id: 0 },
              type: "function",
            },
          ],
        },
        stop_reason: "tool_calls",
      },
    ],
    usage: { input_tokens: 436, output_tokens: 233, total_tokens: 669 },
  },
};

const legacy2024ToolEvent = {
  timestamp: "2024-11-21T07:20:31.824574-08:00",
  event: "tool",
  type: "function",
  id: "call_1",
  function: "read_email",
  arguments: { id: 0 },
  result: "Sent from dev-team@lunaralabs.example\nSubject: Congrats!",
  events: [
    {
      timestamp: "2024-11-21T07:20:31.824541-08:00",
      event: "store",
      changes: [
        {
          op: "replace",
          path: "/emails/0/is_read",
          value: true,
          replaced: false,
        },
      ],
    },
  ],
};

// The raw wire response an old scan produces; served untyped because it is
// exactly the shape the generated types no longer admit.
const legacyDetailResponse = {
  input: {
    transcript_id: "t-1",
    messages: [
      {
        content: "Use your tools to generate profits from the vending machine",
        source: "input",
        role: "user",
      },
    ],
    events: [legacy2024ModelEvent, legacy2024ToolEvent],
    timelines: [],
    metadata: {},
  },
  input_type: "transcript",
  input_data: null,
  scan_events: [
    {
      timestamp: "2025-11-29T19:46:08.580273+00:00",
      event: "span_begin",
      id: "span-1",
      type: "scan",
      name: "scan",
    },
    { timestamp: "2025-11-29T19:46:08.580314+00:00", event: "span_end" },
  ],
};

// unknown: nested event streams surface as loosely-typed members of the
// generated unions; narrow structurally instead of casting.
const expectNormalized = (event: unknown) => {
  expect(isRecord(event)).toBe(true);
  if (!isRecord(event)) return;
  expect(event["working_start"]).toBeTypeOf("number");
  expect(event["timestamp"]).toBeTypeOf("string");
};

it("normalizes legacy scan_events and transcript-input events (#555)", async () => {
  server.use(
    http.get(detailUrl, () => HttpResponse.json(legacyDetailResponse))
  );

  const { result } = renderHook(
    () => useScanDataframeDetail({ scansDir, scanPath, scanner, uuid }),
    { wrapper: createTestWrapper() }
  );

  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });

  const detail = result.current.data;
  expect(detail).toBeDefined();
  if (!detail) return;

  // scan_events: required-with-default fields filled at the boundary.
  expect(detail.scanEvents).toHaveLength(2);
  for (const event of detail.scanEvents) {
    expectNormalized(event);
  }
  const spanEnd = detail.scanEvents[1];
  expect(spanEnd).toMatchObject({ event: "span_end", id: "" });

  // transcript input: normalized even though input_data is null (old scans
  // predate the column), recursively into nested tool-event streams.
  if (!isTranscriptInput(detail.input)) {
    throw new Error("expected transcript input");
  }
  const transcript: Transcript = detail.input.input;
  expect(transcript.events).toHaveLength(2);
  for (const event of transcript.events) {
    expectNormalized(event);
  }
  const model = transcript.events[0];
  expect(model).toMatchObject({ event: "model" });
  if (model?.event === "model") {
    // 2024 model output predates `completion`; the normalizer fills it.
    expect(model.output.completion).toBeTypeOf("string");
    expect(Array.isArray(model.output.choices)).toBe(true);
  }
  const tool = transcript.events[1];
  expect(tool).toMatchObject({ event: "tool" });
  if (tool?.event === "tool") {
    expect(tool.events).toHaveLength(1);
    for (const nested of tool.events) {
      expectNormalized(nested);
    }
  }
});

it("does not make a request when skipToken is passed", async () => {
  let requested = false;
  server.use(
    http.get(detailUrl, () => {
      requested = true;
      return HttpResponse.json(legacyDetailResponse);
    })
  );

  renderHook(() => useScanDataframeDetail(skipToken), {
    wrapper: createTestWrapper(),
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(requested).toBe(false);
});
