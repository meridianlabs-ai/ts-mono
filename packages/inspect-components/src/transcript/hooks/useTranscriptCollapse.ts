/**
 * View-model hook for transcript collapse state.
 *
 * Bridges the app store's collapse callbacks (TranscriptCollapseState) to the
 * event list: bulk collapse/expand and batched expansion for deep links. The
 * store holds only the user's choices; defaults are applied on read
 * (`effectiveCollapsedIds`), so a node that joins the tree later still gets
 * its default.
 */

import { useCallback, useEffect } from "react";

import { collectAllCollapsibleIds } from "../transform/collapse";
import type { EventNode, TranscriptCollapseState } from "../types";

export interface UseTranscriptCollapseOptions {
  /** The EventNode tree (source of collapsible ids). */
  eventNodes: EventNode[];
  /** Collapse state and callbacks from the app store. */
  collapseState?: TranscriptCollapseState;
  /** Bulk collapse/expand of all collapsible events. Omit for no-op. */
  bulkCollapse?: "collapse" | "expand";
  /** Number of events in the sample (bulk collapse is a no-op when 0). */
  eventCount: number;
}

export interface TranscriptCollapse {
  /** Record the user's collapse/expand of a single node. */
  onCollapseTranscript: (nodeId: string, collapsed: boolean) => void;
  /** Batched expansion for deep links into collapsed regions. Undefined when
   *  the store provides no bulk setter. */
  onExpandNodes: ((nodeIds: string[]) => void) | undefined;
}

export function useTranscriptCollapse(
  options: UseTranscriptCollapseOptions
): TranscriptCollapse {
  const { eventNodes, collapseState, bulkCollapse, eventCount } = options;

  const onSetTranscriptCollapsed = collapseState?.onSetTranscriptCollapsed;
  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (eventCount <= 0 || !bulkCollapse || !onSetTranscriptCollapsed) {
      return;
    }
    const collapsed = bulkCollapse === "collapse";
    const ids: Record<string, boolean> = {};
    for (const id of Object.keys(collectAllCollapsibleIds(eventNodes))) {
      ids[id] = collapsed;
    }
    onSetTranscriptCollapsed(ids);
  }, [eventNodes, bulkCollapse, onSetTranscriptCollapsed, eventCount]);

  const onCollapseTranscriptRaw = collapseState?.onCollapseTranscript;
  const onCollapseTranscript = useCallback(
    (nodeId: string, collapsed: boolean) => {
      onCollapseTranscriptRaw?.(nodeId, collapsed);
    },
    [onCollapseTranscriptRaw]
  );

  // One batched update: sequential onCollapseTranscript calls would each
  // re-render the list before the next ancestor opens.
  const transcriptCollapsed = collapseState?.transcript;
  const onExpandNodes = useCallback(
    (nodeIds: string[]) => {
      if (!onSetTranscriptCollapsed) return;
      const next = { ...transcriptCollapsed };
      for (const id of nodeIds) next[id] = false;
      onSetTranscriptCollapsed(next);
    },
    [onSetTranscriptCollapsed, transcriptCollapsed]
  );

  return {
    onCollapseTranscript,
    onExpandNodes: onSetTranscriptCollapsed ? onExpandNodes : undefined,
  };
}
