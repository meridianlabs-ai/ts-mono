/**
 * Collapse policy for the transcript event tree: which nodes start collapsed
 * by default, and which nodes are collapsible at all (for bulk collapse).
 * Pure functions over EventNode trees.
 */

import type {
  SpanBeginEvent,
  StepEvent,
  SubtaskEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";

import { findChangeRenderer } from "../state/StateEventRenderers";
import {
  EventNode,
  EventType,
  isCollapsibleEvent,
  kCollapsibleEventTypes,
  kContentCollapsibleEventTypes,
} from "../types";

import { kSandboxSignalName } from "./fixups";

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

export const isDiffOnlyStateChange = (event: EventType): boolean =>
  (event.event === "state" || event.event === "store") &&
  findChangeRenderer(event.changes, event.event === "store") === undefined;

/**
 * Compute the node IDs that start collapsed by default (system messages,
 * init spans, successful non-agent tool calls, subtasks, and state or store
 * changes that only have a JSON diff to show).
 */
export const computeDefaultCollapsedIds = (
  eventNodes: EventNode[]
): Record<string, true> => {
  const defaultCollapsedIds: Record<string, true> = {};
  const findCollapsibleEvents = (nodes: EventNode[]) => {
    for (const node of nodes) {
      // Bound to a const so the narrowing survives into the callback below.
      const event = node.event;
      if (
        (isCollapsibleEvent(event) &&
          collapseFilters.some((filter) => filter(event))) ||
        isDiffOnlyStateChange(event)
      ) {
        defaultCollapsedIds[node.id] = true;
      }
      findCollapsibleEvents(node.children);
    }
  };
  findCollapsibleEvents(eventNodes);
  return defaultCollapsedIds;
};

// Recorded choices over defaults, so a node that joins the tree later (an event type turned on in the filter, a streamed event) still gets its default.
export const effectiveCollapsedIds = (
  defaults: Record<string, boolean>,
  recorded: Record<string, boolean> | undefined
): Record<string, boolean> =>
  recorded ? { ...defaults, ...recorded } : defaults;

/**
 * Collect every collapsible node ID in the tree (tree-collapsible and
 * content-collapsible), for bulk collapse-all.
 */
export const collectAllCollapsibleIds = (
  nodes: EventNode[]
): Record<string, boolean> => {
  const result: Record<string, boolean> = {};
  const traverse = (nodeList: EventNode[]) => {
    for (const node of nodeList) {
      if (
        kCollapsibleEventTypes.includes(node.event.event) ||
        kContentCollapsibleEventTypes.includes(node.event.event)
      ) {
        result[node.id] = true;
      }
      if (node.children.length > 0) {
        traverse(node.children);
      }
    }
  };
  traverse(nodes);
  return result;
};
