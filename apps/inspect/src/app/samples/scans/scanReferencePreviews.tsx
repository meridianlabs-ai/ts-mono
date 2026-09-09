import { FC, ReactNode } from "react";

import type { ChatMessage, Event } from "@tsmono/inspect-common/types";
import { ChatView } from "@tsmono/inspect-components/chat";
import {
  TranscriptViewNodes,
  useEventNodes,
} from "@tsmono/inspect-components/transcript";

// Shared empty map so the preview component doesn't re-render on reference
// equality changes.
const EMPTY_COLLAPSE: Record<string, boolean> = {};
const noopCollapse = () => {};

const TranscriptPreview: FC<{ id: string; events: Event[] }> = ({
  id,
  events,
}) => {
  const { eventNodes, defaultCollapsedIds } = useEventNodes(events, false);
  return (
    <TranscriptViewNodes
      id={id}
      eventNodes={eventNodes}
      defaultCollapsedIds={defaultCollapsedIds}
      collapsedTranscript={EMPTY_COLLAPSE}
      onCollapseTranscript={noopCollapse}
      keyboardNavDisabled={true}
    />
  );
};

export type ScanReferencePreviews = ReadonlyMap<string, () => ReactNode>;

/**
 * Walk events and build a lookup of reference id → preview renderer.
 *
 * Scanner references can point to either an event uuid or a message id.
 * Event previews render the event inline via a transcript view; message
 * previews render the message inline via a chat view. Messages can live
 * inside ModelEvent input/output, so those are harvested here too.
 *
 * A Map, not a plain object: ids are log-authored, and a reference id such
 * as "constructor" must resolve only to a message or event that really
 * carries that id.
 */
export function buildScanReferencePreviews(
  events: readonly Event[] | undefined
): ScanReferencePreviews {
  const table = new Map<string, () => ReactNode>();
  if (!events || events.length === 0) return table;

  const addMessage = (msg: ChatMessage | null | undefined) => {
    if (!msg?.id || table.has(msg.id)) return;
    const captured = msg;
    table.set(msg.id, () => (
      <ChatView
        id={`ref-preview-${captured.id}`}
        messages={[captured]}
        labels={{ show: false }}
        tools={{ collapseToolMessages: false }}
      />
    ));
  };

  for (const event of events) {
    if (event.uuid && !table.has(event.uuid)) {
      const captured = event;
      table.set(event.uuid, () => (
        <TranscriptPreview
          id={`ref-preview-${captured.uuid}`}
          events={[captured]}
        />
      ));
    }

    if (event.event === "model") {
      for (const msg of event.input) addMessage(msg);
      for (const choice of event.output.choices) {
        addMessage(choice.message);
      }
    }
  }

  return table;
}
