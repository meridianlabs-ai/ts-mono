import type {
  Event,
  SpanBeginEvent,
  SpanEndEvent,
} from "@tsmono/inspect-common/types";

import { EventNode, type EventType } from "../types";

import { transformTree } from "./transform";
import {
  ACTION_BEGIN,
  hasSpans,
  isStructuralEvent,
  SPAN_BEGIN,
  SPAN_END,
  STEP,
  TYPE_SCORER,
  TYPE_SCORERS,
} from "./utils";

/**
 * Node ids are the event uuid. Logs that predate uuids fall back to
 * `fallbackIds` (keyed by event identity; see `eventFallbackIds`) so an id
 * survives filtering, and only then to the tree path.
 */
export function treeifyEvents(
  events: Event[],
  depth: number,
  fallbackIds?: EventIdLookup
): EventNode[] {
  const useSpans = hasSpans(events);

  // First inject spans that may be needed
  events = injectScorersSpan(events);

  const nodes = useSpans
    ? treeifyWithSpans(events, depth, fallbackIds)
    : treeifyWithSteps(events, depth, fallbackIds);

  return useSpans ? transformTree(nodes) : nodes;
}

/** Resolves an event to its position-based fallback id (see `eventFallbackIds`). */
export interface EventIdLookup {
  get(event: Event): string | undefined;
}

/**
 * Position-based ids for events without a uuid. Keyed by event identity, with
 * a (type, timestamp) signature as a second key for the pipeline steps that
 * clone events (lane suffix stripping, retry grouping). The signature is only
 * consulted when unique in `events` and never for span/step events: the
 * pipeline synthesizes those with a neighbour's timestamp, and a match would
 * hand two rows the same id.
 */
export const eventFallbackIds = (events: readonly Event[]): EventIdLookup => {
  const byIdentity = new Map<Event, string>();
  const bySignature = new Map<string, string | null>();
  events.forEach((event, index) => {
    if (event.uuid) return;
    const id = `event_index_${index}`;
    byIdentity.set(event, id);
    if (isStructuralEvent(event)) return;
    const signature = eventSignature(event);
    bySignature.set(signature, bySignature.has(signature) ? null : id);
  });
  return {
    get: (event) =>
      byIdentity.get(event) ??
      (isStructuralEvent(event)
        ? undefined
        : (bySignature.get(eventSignature(event)) ?? undefined)),
  };
};

const eventSignature = (event: Event): string =>
  `${event.event}|${event.timestamp}`;

const treeifyWithSpans = (
  events: Event[],
  depth: number,
  fallbackIds?: EventIdLookup
): EventNode[] => {
  const { rootNodes, createNode } = createNodeFactory(depth, fallbackIds);
  const spanNodes = new Map<string, EventNode>();

  const processEvent = (
    event: EventType,
    parentOverride?: EventNode | null
  ) => {
    if (event.event === SPAN_END) {
      return;
    }

    if (event.event === STEP && event.action !== ACTION_BEGIN) {
      return;
    }

    const resolvedParent =
      parentOverride !== undefined
        ? parentOverride
        : resolveParentForEvent(event, spanNodes);
    const parentNode = resolvedParent ?? null;

    const node = createNode(event, parentNode);

    if (event.event === SPAN_BEGIN) {
      spanNodes.set(event.id, node);
    }
  };

  events.forEach((event: EventType) => processEvent(event));

  return rootNodes;
};

const treeifyWithSteps = (
  events: Event[],
  depth: number,
  fallbackIds?: EventIdLookup
): EventNode[] => {
  const { rootNodes, createNode } = createNodeFactory(depth, fallbackIds);
  const stack: EventNode[] = [];

  const pushStack = (node: EventNode) => {
    stack.push(node);
  };

  const popStack = () => {
    if (stack.length > 0) {
      stack.pop();
    }
  };

  const processEvent = (event: EventType) => {
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;

    switch (event.event) {
      case STEP:
        if (event.action === ACTION_BEGIN) {
          const node = createNode(event, parent || null);
          pushStack(node);
        } else {
          popStack();
        }
        break;
      case SPAN_BEGIN: {
        const node = createNode(event, parent || null);
        pushStack(node);
        break;
      }
      case SPAN_END:
        popStack();
        break;
      default:
        createNode(event, parent || null);
        break;
    }
  };

  events.forEach(processEvent);

  return rootNodes;
};

type NodeFactory = {
  rootNodes: EventNode[];
  createNode: (event: EventType, parent: EventNode | null) => EventNode;
};

const createNodeFactory = (
  depth: number,
  fallbackIds?: EventIdLookup
): NodeFactory => {
  const rootNodes: EventNode[] = [];
  const childCounts = new Map<EventNode | null, number>();
  const pathByNode = new Map<EventNode, string>();

  const createNode = (
    event: EventType,
    parent: EventNode | null
  ): EventNode => {
    const parentKey = parent ?? null;
    const nextIndex = childCounts.get(parentKey) ?? 0;
    childCounts.set(parentKey, nextIndex + 1);

    const parentPath = parent ? pathByNode.get(parent) : undefined;
    const path =
      parentPath !== undefined ? `${parentPath}.${nextIndex}` : `${nextIndex}`;

    const eventId =
      event.uuid || fallbackIds?.get(event) || `event_node_${path}`;
    const nodeDepth = parent ? parent.depth + 1 : depth;

    const node = new EventNode(eventId, event, nodeDepth);
    pathByNode.set(node, path);

    if (parent) {
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }

    return node;
  };

  return { rootNodes, createNode };
};

const resolveParentForEvent = (
  event: EventType,
  spanNodes: Map<string, EventNode>
): EventNode | null => {
  if (event.event === SPAN_BEGIN) {
    const parentId = event.parent_id;
    if (parentId) {
      return spanNodes.get(parentId) ?? null;
    }
    return null;
  }

  const spanId = getEventSpanId(event);
  if (spanId !== null) {
    return spanNodes.get(spanId) ?? null;
  }

  return null;
};

const getEventSpanId = (event: EventType): string | null => {
  const spanId = (event as { span_id?: string | null }).span_id;
  return spanId ?? null;
};

// This injects a scorer span around top level scorer events if one
// isn't already present
const kBeginScorerId = "E617087FA405";
const kEndScorerId = "C39922B09481";
const kScorersSpanId = "C5A831026F2C";
const injectScorersSpan = (events: Event[]): Event[] => {
  const results: Event[] = [];
  const collectedScorerEvents: Event[] = [];
  let hasCollectedScorers = false;
  let collecting: string | null = null;

  const flushCollected = (): Event[] => {
    if (collectedScorerEvents.length > 0) {
      const beginSpan: SpanBeginEvent = {
        name: "scorers",
        id: kBeginScorerId,
        span_id: kScorersSpanId,
        event: SPAN_BEGIN,
        type: TYPE_SCORERS,
        timestamp: collectedScorerEvents[0]?.timestamp || "",
        working_start: collectedScorerEvents[0]?.working_start || 0,
        pending: false,
        parent_id: null,
        uuid: null,
        metadata: null,
      };

      const scoreEvents: Event[] = collectedScorerEvents.map(
        (event: EventType) => {
          return {
            ...event,
            parent_id:
              event.event === "span_begin"
                ? event.parent_id || kScorersSpanId
                : null,
          };
        }
      );

      const endSpan: SpanEndEvent = {
        id: kEndScorerId,
        span_id: kScorersSpanId,
        event: SPAN_END,
        pending: false,
        working_start:
          collectedScorerEvents[collectedScorerEvents.length - 1]
            ?.working_start || 0,
        timestamp:
          collectedScorerEvents[collectedScorerEvents.length - 1]?.timestamp ||
          "",
        uuid: null,
        metadata: null,
      };

      collectedScorerEvents.length = 0;
      hasCollectedScorers = true;
      return [beginSpan, ...scoreEvents, endSpan];
    }
    return [];
  };

  for (const event of events) {
    // Return events immediately if the scorers span is present
    if (event.event === SPAN_BEGIN && event.type === TYPE_SCORERS) {
      return events;
    }

    if (
      event.event === SPAN_BEGIN &&
      event.type === TYPE_SCORER &&
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      !hasCollectedScorers
    ) {
      collecting = event.span_id ?? null;
    }

    // Look for the first scorer event and then begin
    if (collecting) {
      if (event.event === SPAN_END && event.span_id === collecting) {
        collecting = null;
        results.push(...flushCollected());
        results.push(event);
      } else {
        collectedScorerEvents.push(event);
      }
    } else {
      results.push(event);
    }
  }

  return results;
};

/**
 * Remove span/step nodes with no visible children (filtering recursively, in
 * place on each node's `children`). Nodes with an attached `sourceSpan`
 * (agent cards) and structural `fork_nav`/`empty_branch` spans are preserved
 * even when childless.
 */
export const filterEmptySpans = (
  eventNodes: EventNode<EventType>[]
): EventNode<EventType>[] => {
  return eventNodes.filter((node) => {
    if (node.children.length > 0) {
      node.children = filterEmptySpans(node.children);
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
      node.children.length > 0
    );
  });
};
