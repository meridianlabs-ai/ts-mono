import { describe, expect, it } from "vitest";

import type {
  Event,
  ModelEvent,
  StateEvent,
} from "@tsmono/inspect-common/types";

import { groupRetryAttempts, retryAttemptKey } from "./retryGrouping";

const NULL_CONFIG = {} as ModelEvent["config"];
const EMPTY_OUTPUT = {
  choices: [],
  usage: null,
  time: null,
  metadata: null,
  error: null,
} as unknown as ModelEvent["output"];

function model(
  timestamp: string,
  options?: { error?: string; spanId?: string | null }
): ModelEvent {
  return {
    event: "model",
    model: "test",
    role: null,
    input: [],
    input_refs: null,
    tools: [],
    tool_choice: "auto",
    config: NULL_CONFIG,
    output: EMPTY_OUTPUT,
    cache: null,
    call: null,
    error: options?.error ?? null,
    span_id: options?.spanId === undefined ? null : options.spanId,
    timestamp,
    working_start: 0,
  } as unknown as ModelEvent;
}

function state(timestamp: string): StateEvent {
  return {
    event: "state",
    changes: [],
    span_id: null,
    timestamp,
    working_start: 0,
  } as unknown as StateEvent;
}

describe("groupRetryAttempts", () => {
  it("returns input reference unchanged when no retries exist", () => {
    const events: Event[] = [
      model("2025-01-01T00:00:00.000Z"),
      model("2025-01-01T00:00:01.000Z"),
    ];
    const out = groupRetryAttempts(events);
    expect(out.events).toBe(events);
    expect(out.attempts.size).toBe(0);
  });

  it("folds a single failed attempt before a success", () => {
    const failed = model("2025-01-01T00:00:00.000Z", { error: "transient" });
    const success = model("2025-01-01T00:00:01.000Z");
    const events: Event[] = [failed, success];
    const out = groupRetryAttempts(events);
    expect(out.events).toEqual([success]);
    expect(out.attempts.get(retryAttemptKey(success))).toEqual([
      failed,
      success,
    ]);
  });

  it("folds three failed attempts before a success", () => {
    const f1 = model("2025-01-01T00:00:00.000Z", { error: "e1" });
    const f2 = model("2025-01-01T00:00:01.000Z", { error: "e2" });
    const f3 = model("2025-01-01T00:00:02.000Z", { error: "e3" });
    const ok = model("2025-01-01T00:00:03.000Z");
    const events: Event[] = [f1, f2, f3, ok];
    const out = groupRetryAttempts(events);
    expect(out.events).toEqual([ok]);
    expect(out.attempts.get(retryAttemptKey(ok))).toEqual([f1, f2, f3, ok]);
  });

  it("scopes grouping per span_id (sibling spans don't interfere)", () => {
    const aFail = model("2025-01-01T00:00:00.000Z", {
      spanId: "A",
      error: "transient",
    });
    const bOk1 = model("2025-01-01T00:00:00.500Z", { spanId: "B" });
    const bOk2 = model("2025-01-01T00:00:01.000Z", { spanId: "B" });
    const aOk = model("2025-01-01T00:00:02.000Z", { spanId: "A" });
    const events: Event[] = [aFail, bOk1, bOk2, aOk];
    const out = groupRetryAttempts(events);
    expect(out.events).toEqual([bOk1, bOk2, aOk]);
    expect(out.attempts.get(retryAttemptKey(aOk))).toEqual([aFail, aOk]);
    expect(out.attempts.has(retryAttemptKey(bOk1))).toBe(false);
    expect(out.attempts.has(retryAttemptKey(bOk2))).toBe(false);
  });

  it("preserves non-ModelEvents interleaved with the retry run", () => {
    const failed = model("2025-01-01T00:00:00.000Z", { error: "transient" });
    const stateEvent = state("2025-01-01T00:00:00.500Z");
    const success = model("2025-01-01T00:00:01.000Z");
    const events: Event[] = [failed, stateEvent, success];
    const out = groupRetryAttempts(events);
    expect(out.events).toEqual([stateEvent, success]);
    expect(out.attempts.get(retryAttemptKey(success))).toEqual([
      failed,
      success,
    ]);
  });

  it("handles two consecutive retried calls in the same span", () => {
    const f1 = model("2025-01-01T00:00:00.000Z", { error: "e1" });
    const ok1 = model("2025-01-01T00:00:01.000Z");
    const f2 = model("2025-01-01T00:00:02.000Z", { error: "e2" });
    const ok2 = model("2025-01-01T00:00:03.000Z");
    const events: Event[] = [f1, ok1, f2, ok2];
    const out = groupRetryAttempts(events);
    expect(out.events).toEqual([ok1, ok2]);
    expect(out.attempts.get(retryAttemptKey(ok1))).toEqual([f1, ok1]);
    expect(out.attempts.get(retryAttemptKey(ok2))).toEqual([f2, ok2]);
  });

  it("does not group a single-attempt call", () => {
    const ok = model("2025-01-01T00:00:00.000Z");
    const events: Event[] = [ok];
    const out = groupRetryAttempts(events);
    expect(out.events).toBe(events);
    expect(out.attempts.size).toBe(0);
  });

  it("leaves trailing failed attempts untouched (no terminal success)", () => {
    const f1 = model("2025-01-01T00:00:00.000Z", { error: "e1" });
    const f2 = model("2025-01-01T00:00:01.000Z", { error: "e2" });
    const events: Event[] = [f1, f2];
    const out = groupRetryAttempts(events);
    expect(out.events).toBe(events);
    expect(out.attempts.size).toBe(0);
  });
});
