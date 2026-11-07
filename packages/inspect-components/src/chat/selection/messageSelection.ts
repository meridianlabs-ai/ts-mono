import type {
  ChatMessage,
  ChatMessageSystem,
} from "@tsmono/inspect-common/types";

import { mergedSystemMessage, MessageFold, withDisplayId } from "../messages";

const isSystemMessage = (message: ChatMessage): message is ChatMessageSystem =>
  message.role === "system";

/**
 * Id → messages for every selectable row, in the order the chat renders
 * them, built from the full (unfiltered) conversation with the chat's own
 * fold so ids resolve regardless of the filter or lane they were selected
 * under. Ids are the message id, or the fold's position-based `msg-<n>` for
 * logs that predate ids — window-invariant, so the same message takes the
 * same id however much of the conversation is loaded. Values are the
 * original message objects wherever the id maps back to one; a row's tool
 * messages ride along with their head message (that is what the reader
 * sees), and the merged system row resolves to the original system
 * messages. A full fold — call it at export time, not per render.
 */
export const buildSelectableMessageIndex = (
  messages: readonly ChatMessage[]
): ReadonlyMap<string, ChatMessage[]> => {
  const rows: { id: string; messages: ChatMessage[] }[] = [];
  const originals = new Map<ChatMessage, ChatMessage>();
  const fold = new MessageFold((row) => {
    // System messages never render as their own row; the merged system row
    // below stands in for all of them.
    if (row.message.role === "system") return;
    // The fold mints `msg-<position>` for id-less messages; a null id passes
    // the fold through and can't key a row, so it stays unselectable.
    const id = row.message.id;
    if (typeof id === "string") {
      rows.push({
        id,
        messages: [row.message, ...row.toolMessages].map(
          (message) => originals.get(message) ?? message
        ),
      });
    }
  });
  messages.forEach((message, index) => {
    // Give the fold its display ID without changing the exported object.
    const resolved = withDisplayId(message, index);
    originals.set(resolved, message);
    fold.next(resolved, index);
  });
  fold.end();
  const systemMessages = messages.filter(isSystemMessage);
  const merged = mergedSystemMessage(systemMessages);
  const mergedId = merged?.id;
  // The merged system row renders first, like the chat list shows it.
  const ordered =
    typeof mergedId === "string"
      ? [{ id: mergedId, messages: systemMessages }, ...rows]
      : rows;
  return new Map(ordered.map((row) => [row.id, row.messages]));
};
