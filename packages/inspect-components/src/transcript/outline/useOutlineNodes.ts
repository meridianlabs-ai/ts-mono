/**
 * Derivation of the outline's row list from the transcript EventNode tree.
 */

import { useMemo } from "react";

import { kSandboxSignalName } from "../transform/fixups";
import { flatTree } from "../transform/flatten";
import { EventNode } from "../types";

import {
  collapseScoring,
  collapseTurns,
  makeTurns,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
} from "./tree-visitors";

/**
 * Build the outline's row list: flatten the tree with the outline's
 * visibility visitors, then group model/tool runs into turns and collapse
 * consecutive turns and scoring events.
 */
export const buildOutlineNodeList = (
  eventNodes: EventNode[],
  collapsedIds: Record<string, boolean>
): EventNode[] => {
  const nodeList = flatTree(eventNodes, collapsedIds, [
    removeNodeVisitor("logger"),
    removeNodeVisitor("info"),
    removeNodeVisitor("state"),
    removeNodeVisitor("store"),
    removeNodeVisitor("approval"),
    removeNodeVisitor("input"),
    removeNodeVisitor("sandbox"),
    removeStepSpanNameVisitor(kSandboxSignalName),
    noScorerChildren(),
  ]);

  return collapseScoring(collapseTurns(makeTurns(nodeList)));
};

export interface OutlineNodes {
  /** Rows displayed in the outline. */
  outlineNodeList: EventNode[];
  /** Full flattened node list (unfiltered), for scroll tracking. */
  allNodesList: EventNode[];
}

export const useOutlineNodes = (
  eventNodes: EventNode[],
  collapsedEvents: Record<string, boolean> | undefined,
  defaultCollapsedIds: Record<string, boolean>
): OutlineNodes => {
  const outlineNodeList = useMemo(
    () =>
      buildOutlineNodeList(
        eventNodes,
        (collapsedEvents ? collapsedEvents : undefined) || defaultCollapsedIds
      ),
    [eventNodes, collapsedEvents, defaultCollapsedIds]
  );

  const allNodesList = useMemo(() => {
    return flatTree(eventNodes, null);
  }, [eventNodes]);

  return { outlineNodeList, allNodesList };
};
