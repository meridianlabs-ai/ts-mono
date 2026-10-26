import { afterEach, describe, expect, it, vi } from "vitest";

import { testSpanBeginEvent } from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import { AgentSpans } from "./core";

/** An agent span with `depth` non-agent spans nested below it, innermost last. */
function chain(depth: number): Event[] {
  return Array.from({ length: depth + 1 }, (_, i) =>
    testSpanBeginEvent({
      id: `s${i}`,
      name: `s${i}`,
      type: i === 0 ? "agent" : "solver",
      parent_id: i === 0 ? null : `s${i - 1}`,
    })
  );
}

/**
 * The work of looking up the innermost span's agent span: map and set
 * lookups, and the elements any array search scans.
 */
function lookupWork(depth: number): number {
  const spans = new AgentSpans(chain(depth));
  const gets = vi.spyOn(Map.prototype, "get");
  const has = vi.spyOn(Set.prototype, "has");
  const includes = vi.spyOn(Array.prototype, "includes");
  expect(spans.of(`s${depth}`)).toBe("s0");
  const scanned = includes.mock.contexts.reduce(
    (total: number, array) => total + (Array.isArray(array) ? array.length : 0),
    0
  );
  const work = gets.mock.calls.length + has.mock.calls.length + scanned;
  vi.restoreAllMocks();
  return work;
}

describe("AgentSpans", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("finds a span's agent span in work linear in its depth", () => {
    const small = lookupWork(500);
    const large = lookupWork(1000);
    expect(large).toBeLessThanOrEqual(2.2 * small + 10);
  });

  it("stops at a parent_id cycle", () => {
    const spans = new AgentSpans([
      testSpanBeginEvent({
        id: "a",
        name: "a",
        type: "solver",
        parent_id: "b",
      }),
      testSpanBeginEvent({
        id: "b",
        name: "b",
        type: "solver",
        parent_id: "a",
      }),
    ]);
    expect(spans.of("a")).toBeNull();
  });
});
