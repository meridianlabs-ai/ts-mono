/**
 * Scout-specific wrapper around the shared TranscriptViewNodes.
 *
 * Wires Scout's Zustand store (transcriptCollapsedEvents) to the shared
 * component's callback props. The imperative handle and all other props
 * are forwarded unchanged.
 */

import { forwardRef, useCallback } from "react";

import {
  TranscriptViewNodes as SharedTranscriptViewNodes,
  type TranscriptViewNodesProps as SharedProps,
  type TranscriptViewNodesHandle,
} from "@tsmono/inspect-components/transcript";

import { useStore } from "../../state/store";

type TranscriptViewNodesProps = Omit<
  SharedProps,
  "collapsedEvents" | "onCollapse"
>;

export type { TranscriptViewNodesHandle };

export const TranscriptViewNodes = forwardRef<
  TranscriptViewNodesHandle,
  TranscriptViewNodesProps
>(function TranscriptViewNodes(props, ref) {
  const collapsedEvents = useStore((state) => state.transcriptCollapsedEvents);
  const setTranscriptCollapsedEvent = useStore(
    (state) => state.setTranscriptCollapsedEvent
  );

  const onCollapse = useCallback(
    (scope: string, nodeId: string, collapsed: boolean) => {
      setTranscriptCollapsedEvent(scope, nodeId, collapsed);
    },
    [setTranscriptCollapsedEvent]
  );

  return (
    <SharedTranscriptViewNodes
      ref={ref}
      {...props}
      collapsedEvents={collapsedEvents}
      onCollapse={onCollapse}
    />
  );
});
