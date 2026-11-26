import { describe, expect, it, vi } from "vitest";

import { testToolEvent } from "@tsmono/inspect-common/testing";
import type { ContentImage, EvalSample } from "@tsmono/inspect-common/types";

import { ClientAPI, SampleSummary } from "../client/api/types";

import {
  fetchSample,
  resolveSample,
  SampleNotFoundError,
  synthesizeErroredSampleFromSummary,
} from "./sampleFetch";
import { testClientAPI, testSampleSummary } from "./testFixtures";

const msg = (id: string, role: string, content: string) => ({
  id,
  role,
  content,
  source: "input",
  metadata: {},
});

const modelEvent = (input: unknown[], input_refs?: unknown[] | null) => ({
  event: "model",
  input,
  input_refs: input_refs ?? null,
});

const modelEventWithCall = (
  request: Record<string, unknown>,
  call_refs?: unknown[] | null,
  call_key?: string | null
) => ({
  event: "model",
  input: [],
  input_refs: null,
  call: {
    request,
    response: null,
    call_refs: call_refs ?? null,
    call_key: call_key ?? null,
  },
});

const makeSample = (overrides: Record<string, unknown> = {}) => ({
  input: "test input",
  messages: [],
  events: [],
  attachments: {},
  events_data: null,
  ...overrides,
});

const sys = msg("msg-1", "system", "You are helpful.");
const usr = msg("msg-2", "user", "What is 2+2?");
const msgs = [
  msg("0", "system", "Sys"),
  msg("1", "user", "Q1"),
  msg("2", "assistant", "A1"),
  msg("3", "user", "Q2"),
  msg("4", "assistant", "A2"),
];

describe("resolveSample", () => {
  it.each([
    {
      name: "resolves input_refs from events_data",
      sample: makeSample({
        events_data: { messages: [sys, usr], calls: [] },
        events: [modelEvent([], [[0, 2]])],
      }),
      check: (resolved: EvalSample) => {
        expect(resolved).toHaveProperty("events.0.input", [sys, usr]);
        expect(resolved).toHaveProperty("events.0.input_refs", null);
        expect(resolved).toHaveProperty("events_data", null);
      },
    },
    {
      name: "resolves call_refs from events_data",
      sample: makeSample({
        events_data: {
          messages: [],
          calls: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi" },
          ],
        },
        events: [modelEventWithCall({ model: "test" }, [[0, 2]], "messages")],
      }),
      check: (resolved: EvalSample) => {
        expect(resolved).toHaveProperty("events.0.call.request.messages", [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
        ]);
        expect(resolved).toHaveProperty("events.0.call.call_refs", null);
        expect(resolved).toHaveProperty("events_data", null);
      },
    },
    {
      name: "uses call_key to restore under a custom key",
      sample: makeSample({
        events_data: {
          messages: [],
          calls: [{ role: "user", content: "Hello via contents" }],
        },
        events: [modelEventWithCall({ model: "test" }, [[0, 1]], "contents")],
      }),
      check: (resolved: EvalSample) => {
        expect(resolved).toHaveProperty("events.0.call.request.contents", [
          { role: "user", content: "Hello via contents" },
        ]);
        expect(resolved).not.toHaveProperty("events.0.call.request.messages");
      },
    },
    {
      name: "resolves pool before attachments",
      sample: makeSample({
        events_data: {
          messages: [msg("msg-1", "user", "attachment://abc123")],
          calls: [],
        },
        attachments: { abc123: "resolved content" },
        events: [modelEvent([], [[0, 1]])],
      }),
      check: (resolved: EvalSample) => {
        expect(resolved).toHaveProperty(
          "events.0.input.0.content",
          "resolved content"
        );
      },
    },
    {
      name: "resolves non-contiguous range refs",
      sample: makeSample({
        events_data: { messages: msgs, calls: [] },
        events: [
          modelEvent(
            [],
            [
              [0, 1],
              [3, 5],
            ]
          ),
        ],
      }),
      check: (resolved: EvalSample) => {
        expect(resolved).toHaveProperty("events.0.input", [
          msgs[0],
          msgs[3],
          msgs[4],
        ]);
      },
    },
  ])("$name", ({ sample, check }) => {
    check(resolveSample(sample));
  });

  it("resolves attachment refs inside error_retries events", () => {
    const sample = makeSample({
      attachments: { abc123: "the real failed message body" },
      error_retries: [
        {
          message: "RuntimeError",
          traceback: "tb",
          traceback_ansi: "tb",
          events: [modelEvent([msg("m1", "user", "attachment://abc123")])],
        },
      ],
    });
    const resolved = resolveSample(sample);
    expect(resolved).toHaveProperty(
      "error_retries.0.events.0.input.0.content",
      "the real failed message body"
    );
  });

  it("leaves tool result text as written", () => {
    const image = {
      type: "image",
      image: "attachment://img",
      detail: "auto",
    } satisfies ContentImage;
    const tool = testToolEvent({
      result: [{ type: "text", text: "attachment://sys" }, image],
    });
    const retryTool = testToolEvent({ result: "tc://sys" });
    const resolved = resolveSample(
      makeSample({
        attachments: { sys: "system prompt", img: "image data" },
        events: [tool],
        error_retries: [
          {
            message: "RuntimeError",
            traceback: "tb",
            traceback_ansi: "tb",
            events: [retryTool],
          },
        ],
      })
    );
    expect(resolved).toHaveProperty("events.0.result", [
      { type: "text", text: "attachment://sys" },
      { ...image, image: "image data" },
    ]);
    expect(resolved).toHaveProperty(
      "error_retries.0.events.0.result",
      "tc://sys"
    );
  });

  // inspect_ai's walk_input leaves a string input as written and resolves a
  // message-list input.
  it.each(["attachment://", "tc://"])(
    "resolves %s refs in message-list input but not in string input",
    (protocol) => {
      const attachments = { sys: "system prompt" };
      expect(
        resolveSample(makeSample({ input: `${protocol}sys`, attachments }))
          .input
      ).toBe(`${protocol}sys`);
      expect(
        resolveSample(
          makeSample({
            input: [msg("m1", "user", `${protocol}sys`)],
            messages: [msg("m1", "user", `${protocol}sys`)],
            attachments,
          })
        )
      ).toMatchObject({
        input: [{ content: "system prompt" }],
        messages: [{ content: "system prompt" }],
      });
    }
  );
});

describe("fetchSample", () => {
  const makeApi = (get_log_sample: ClientAPI["get_log_sample"]) =>
    testClientAPI({ get_log_sample });

  it("fetches with the handle's coordinates and normalizes the EvalSample", async () => {
    const get_log_sample = vi.fn().mockResolvedValue(
      makeSample({
        events_data: { messages: [sys, usr], calls: [] },
        events: [modelEvent([], [[0, 2]])],
      })
    );

    const sample = await fetchSample(
      makeApi(get_log_sample),
      "log.eval",
      "sample-1",
      2
    );

    expect(get_log_sample).toHaveBeenCalledWith("log.eval", "sample-1", 2);
    expect(sample).toHaveProperty("events.0.input", [sys, usr]);
    expect(sample).toHaveProperty("events_data", null);
    expect(sample).toHaveProperty("attachments", {});
  });

  it("throws SampleNotFoundError when the backend has no EvalSample", async () => {
    const get_log_sample = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchSample(makeApi(get_log_sample), "log.eval", "sample-1", 1)
    ).rejects.toBeInstanceOf(SampleNotFoundError);
  });

  it("propagates backend errors unchanged", async () => {
    const failure = new Error("read failure");
    const get_log_sample = vi.fn().mockRejectedValue(failure);

    await expect(
      fetchSample(makeApi(get_log_sample), "log.eval", "sample-1", 1)
    ).rejects.toBe(failure);
  });
});

describe("synthesizeErroredSampleFromSummary", () => {
  const baseSummary = (overrides: Partial<SampleSummary> = {}): SampleSummary =>
    testSampleSummary({
      id: "rocket-medium-vision",
      input: "task input",
      target: "expected target",
      error: "RuntimeError: server.py exited before becoming ready",
      ...overrides,
    });

  it("populates EvalSample.error from the summary's error string", () => {
    const sample = synthesizeErroredSampleFromSummary(baseSummary());

    expect(sample.error).toBeTruthy();
    expect(sample.error?.message).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
    expect(sample.error?.traceback).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
    expect(sample.error?.traceback_ansi).toBe(
      "RuntimeError: server.py exited before becoming ready"
    );
  });

  it("keeps the summary's sentinel stats, which the sample's Info tab shows", () => {
    const sentinel_stats = {
      guard: {
        steps: { tool_call: { total: 1, judged: 1, unjudged: {} } },
        complete: true,
      },
    };
    const sample = synthesizeErroredSampleFromSummary(
      baseSummary({ sentinel_stats })
    );

    expect(sample.sentinel_stats).toEqual(sentinel_stats);
  });

  it("does not propagate the summary's string limit (EvalSample.limit is an object | null)", () => {
    const sample = synthesizeErroredSampleFromSummary(
      baseSummary({ limit: "context" })
    );

    expect(sample.limit).toBeNull();
  });

  it("returns empty events / messages / attachments / output", () => {
    const sample = synthesizeErroredSampleFromSummary(baseSummary());

    expect(sample.events).toEqual([]);
    expect(sample.messages).toEqual([]);
    expect(sample.attachments).toEqual({});
    expect(sample.output).toBeDefined();
    expect(sample.output.choices).toEqual([]);
  });

  it("survives resolveSample without throwing", () => {
    const sample = synthesizeErroredSampleFromSummary(baseSummary());
    expect(() => resolveSample(sample)).not.toThrow();
  });

  it("throws if the summary has no error", () => {
    expect(() =>
      synthesizeErroredSampleFromSummary(baseSummary({ error: undefined }))
    ).toThrow();
  });
});
