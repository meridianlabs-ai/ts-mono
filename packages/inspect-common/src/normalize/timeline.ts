import { isRecord } from "@tsmono/util";

import type { Timeline, TimelineEvent, TimelineSpan } from "../types";

/**
 * Timelines as the wire may carry them: the required-with-default span
 * fields (`type`, `tool_invoked`, `utility`, and the two lists pydantic
 * builds with default_factory) optional. The normalizers below turn these
 * into the generated types by construction.
 */
export interface WireTimelineEvent extends Omit<TimelineEvent, "type"> {
  type?: "event";
}

export interface WireTimelineSpan extends Omit<
  TimelineSpan,
  "type" | "tool_invoked" | "utility" | "branches" | "content"
> {
  type?: "span";
  tool_invoked?: boolean;
  utility?: boolean;
  branches?: WireTimelineSpan[];
  content?: (WireTimelineEvent | WireTimelineSpan)[];
}

export interface WireTimeline extends Omit<Timeline, "root"> {
  root: WireTimelineSpan;
}

/**
 * A timeline is the only sample/transcript field shaped as a record with a
 * `root` record; this is the same claim the surrounding parse already made.
 */
export const isWireTimeline = (raw: unknown): raw is WireTimeline =>
  isRecord(raw) && isRecord(raw["root"]);

// `type` defaults upstream, so an old writer may have omitted it: an item
// carrying an event reference is an event, anything else is a span.
const isWireTimelineEvent = (
  item: WireTimelineEvent | WireTimelineSpan
): item is WireTimelineEvent =>
  item.type === "event" || (item.type === undefined && "event" in item);

export const normalizeTimelineSpan = (raw: WireTimelineSpan): TimelineSpan => ({
  ...raw,
  type: "span",
  tool_invoked: raw.tool_invoked ?? false,
  utility: raw.utility ?? false,
  branches: (raw.branches ?? []).map(normalizeTimelineSpan),
  content: (raw.content ?? []).map((item): TimelineEvent | TimelineSpan =>
    isWireTimelineEvent(item)
      ? { ...item, type: "event" }
      : normalizeTimelineSpan(item)
  ),
});

export const normalizeTimeline = (raw: WireTimeline): Timeline => ({
  ...raw,
  root: normalizeTimelineSpan(raw.root),
});

export const normalizeTimelines = (raw: WireTimeline[]): Timeline[] =>
  raw.map(normalizeTimeline);
