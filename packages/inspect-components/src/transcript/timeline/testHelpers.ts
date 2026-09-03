/**
 * Shared test utilities for timeline tests.
 *
 * Provides common helpers used across swimlaneRows, swimlaneLayout,
 * markers, and useTimeline test files.
 */

import {
  testModelEvent,
  testModelOutput,
  testModelUsage,
  testSpanBeginEvent,
  testSpanEndEvent,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import { TimelineEvent, TimelineSpan, type Timeline } from "./core";
import { timelineScenarios } from "./syntheticNodes";

export { timelineScenarios };

// =============================================================================
// Timestamp helper
// =============================================================================

const BASE = new Date("2025-01-15T10:00:00Z").getTime();

/** Creates a Date offset from a fixed base time by the given number of seconds. */
export function ts(offsetSeconds: number): Date {
  return new Date(BASE + offsetSeconds * 1000);
}

// =============================================================================
// Raw event builders (for buildTimeline input)
// =============================================================================

/**
 * Builders for raw Event sequences fed to buildTimeline: a mutable clock
 * yielding distinct monotonically increasing timestamps, common event fields,
 * and span begin/end events. Each call returns an independent clock so test
 * files stay isolated. Named nextTs (not ts) to avoid shadowing this module's
 * offset-based ts() when destructured.
 */
export function rawEventBuilders() {
  let clock = 0;
  const nextTs = (): string => {
    clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
  };

  const base = () => ({
    uuid: null,
    timestamp: nextTs(),
    working_start: 0,
    pending: false,
    metadata: null,
  });

  const spanBegin = (
    id: string,
    name: string,
    type: string | null,
    parentId: string | null
  ): Event =>
    testSpanBeginEvent({
      ...base(),
      id,
      name,
      type,
      parent_id: parentId,
      span_id: null,
    });

  const spanEnd = (id: string): Event =>
    testSpanEndEvent({ ...base(), id, span_id: null });

  return { nextTs, base, spanBegin, spanEnd };
}

// =============================================================================
// Span builder
// =============================================================================

interface MakeSpanOptions {
  utility?: boolean;
  spanType?: string | null;
  branches?: TimelineSpan[];
}

/**
 * Creates a synthetic TimelineEvent at the given time range with specified tokens.
 * Used internally by makeSpan when no content is provided.
 */
export function makeSyntheticEvent(
  startSec: number,
  endSec: number,
  tokens: number
): TimelineEvent {
  const event = testModelEvent({
    timestamp: ts(startSec).toISOString(),
    completed: ts(endSec).toISOString(),
    working_start: startSec,
    working_time: endSec - startSec,
    output: testModelOutput({
      usage: testModelUsage({
        input_tokens: Math.floor(tokens * 0.6),
        output_tokens: tokens - Math.floor(tokens * 0.6),
        total_tokens: tokens,
      }),
    }),
  });
  return new TimelineEvent(event);
}

/** Minimal TimelineSpan builder for edge-case tests. */
export function makeSpan(
  name: string,
  startSec: number,
  endSec: number,
  tokens: number,
  content: TimelineSpan["content"] = [],
  options?: MakeSpanOptions
): TimelineSpan {
  // When no content provided, create a synthetic event so computed
  // startTime/endTime/totalTokens match the specified values.
  const effectiveContent: (TimelineEvent | TimelineSpan)[] =
    content.length > 0
      ? content
      : [makeSyntheticEvent(startSec, endSec, tokens)];

  return new TimelineSpan({
    id: name.toLowerCase(),
    name,
    spanType: options?.spanType ?? null,
    content: effectiveContent,
    branches: options?.branches ?? [],
    utility: options?.utility ?? false,
  });
}

// =============================================================================
// Scenario index constants
// =============================================================================

export const S1_SEQUENTIAL = 0;
export const S2_ITERATIVE = 1;
export const S3_DEEP = 2;
export const S4_PARALLEL = 3;
export const S5_MARKERS = 4;
export const S7_FLAT = 5;
export const S8_MANY = 6;
export const S10_UTILITY = 7;
export const S11A_BRANCHES = 8;
export const S11B_BRANCHES_MULTI = 9;

// =============================================================================
// Scenario lookup helpers
// =============================================================================

/** Returns the root TimelineSpan for a scenario by index. */
export function getScenarioRoot(index: number): TimelineSpan {
  const scenario = timelineScenarios[index];
  if (!scenario) throw new Error(`No scenario at index ${index}`);
  return scenario.timeline.root;
}

/** Returns the full Timeline for a scenario by index. */
export function getTimeline(index: number): Timeline {
  const scenario = timelineScenarios[index];
  if (!scenario) throw new Error(`No scenario at index ${index}`);
  return scenario.timeline;
}
