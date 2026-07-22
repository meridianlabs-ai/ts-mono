/**
 * Shared hook that builds an EventNode tree from raw events.
 *
 * Handles fixup, treeification, empty-span filtering, source-span attachment
 * (for agent card rendering), and default-collapse computation.
 */

import { useMemo } from "react";

import type {
  Event,
  ModelEvent,
  SpanBeginEvent,
  StepEvent,
  SubtaskEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { fixupEventStream, kSandboxSignalName } from "../../transform/fixups";
import { treeifyEvents } from "../../transform/treeify";
import { EventNode, kCollapsibleEventTypes } from "../../types";
import type { EventType } from "../../types";
import type { TimelineSpan } from "../core";
import { groupRetryAttempts } from "../retryGrouping";
import { correctRetryTimestamps } from "../retryOrdering";
import { attachSourceSpans } from "../timelineEventNodes";

// =============================================================================
// Collapse filters
// =============================================================================

const collapseFilters: Array<
  (event: StepEvent | SpanBeginEvent | ToolEvent | SubtaskEvent) => boolean
> = [
  (event) => event.type === "solver" && event.name === "system_message",
  (event) => {
    if (event.event === "step" || event.event === "span_begin") {
      return (
        event.name === kSandboxSignalName ||
        event.name === "init" ||
        event.name === "sample_init"
      );
    }
    return false;
  },
  (event) => event.event === "tool" && !event.agent && !event.failed,
  (event) => event.event === "subtask",
];

// =============================================================================
// Pure core
// =============================================================================

export interface EventNodesResult {
  eventNodes: EventNode[];
  defaultCollapsedIds: Record<string, true>;
  retryAttempts: Map<string, ModelEvent[]>;
}

/**
 * Build an EventNode tree from raw events (pure core of `useEventNodes`).
 *
 * Exposed for headless consumers (tests, non-React derivations) that need
 * the exact production pipeline: retry ordering/grouping, fixups,
 * treeification, empty-span filtering, source-span attachment, and
 * default-collapse computation.
 */
export const buildEventNodes = (
  events: Event[],
  running: boolean,
  sourceSpans?: ReadonlyMap<string, TimelineSpan>
): EventNodesResult => {
  // Repair retry-inverted ModelEvent timestamps before any downstream
  // sort sees them (treeifyEvents sorts span children by timestamp).
  const orderedEvents = correctRetryTimestamps(events);

  // Fold consecutive same-span failed→success ModelEvent runs into a
  // single visible event; the failed siblings are removed from the
  // stream and surfaced via the retryAttempts map for the chip UI.
  const { events: groupedEvents, attempts: retryAttempts } =
    groupRetryAttempts(orderedEvents);

  // Apply fixups to the event stream
  const resolvedEvents = fixupEventStream(groupedEvents, !running);

  // Build the event tree
  const rawEventTree = treeifyEvents(resolvedEvents, 0);

  // Attach source span references before filtering so filterEmpty
  // can preserve agent card nodes (which have no children by design).
  if (sourceSpans && sourceSpans.size > 0) {
    attachSourceSpans(rawEventTree, sourceSpans);
  }

  // Filter the tree to remove empty spans
  const filterEmpty = (
    eventNodes: EventNode<EventType>[]
  ): EventNode<EventType>[] => {
    return eventNodes.filter((node) => {
      if (node.children && node.children.length > 0) {
        node.children = filterEmpty(node.children);
      }
      // Preserve nodes with a sourceSpan (e.g. agent cards)
      if (node.sourceSpan) return true;
      if (
        node.event.event === "span_begin" &&
        (node.event.type === "fork_nav" || node.event.type === "empty_branch")
      ) {
        return true;
      }
      return (
        (node.event.event !== "span_begin" && node.event.event !== "step") ||
        (node.children && node.children.length > 0)
      );
    });
  };
  const eventNodes = filterEmpty(rawEventTree);

  // Compute default collapsed IDs
  const defaultCollapsedIds: Record<string, true> = {};
  const findCollapsibleEvents = (nodes: EventNode[]) => {
    for (const node of nodes) {
      if (
        kCollapsibleEventTypes.includes(node.event.event) &&
        collapseFilters.some((filter) =>
          filter(
            node.event as StepEvent | SpanBeginEvent | ToolEvent | SubtaskEvent
          )
        )
      ) {
        defaultCollapsedIds[node.id] = true;
      }
      findCollapsibleEvents(node.children);
    }
  };
  findCollapsibleEvents(eventNodes);

  return { eventNodes, defaultCollapsedIds, retryAttempts };
};

// =============================================================================
// Hook
// =============================================================================

export const useEventNodes = (
  events: Event[],
  running: boolean,
  sourceSpans?: ReadonlyMap<string, TimelineSpan>
) => {
  return useMemo(
    () => buildEventNodes(events, running, sourceSpans),
    [events, running, sourceSpans]
  );
};
