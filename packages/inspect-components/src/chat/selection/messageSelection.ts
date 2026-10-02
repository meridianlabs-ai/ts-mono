import type {
  ChatMessage,
  ChatMessageSystem,
} from "@tsmono/inspect-common/types";

import { mergedSystemMessage, MessageFold } from "../messages";

/**
 * Evidence selection for message export: the chat rows a reviewer has
 * checked plus the anchor for shift-click ranges. Hosts own the state (store
 * or component state); the chat list only reads it and hands back the next
 * state through `onChange`.
 */
export interface MessageSelectionState {
  /** Selected row ids: the message id, or the position-based `msg-<n>` the
   *  fold mints for logs that predate ids (see `buildSelectableMessageIndex`). */
  selectedIds: ReadonlySet<string>;
  /** Last individually toggled id; shift-click extends from here. */
  lastToggledId: string | null;
}

/** Host adapter handed to the chat list; present only while selection mode is on. */
export interface MessageSelection extends MessageSelectionState {
  onChange: (state: MessageSelectionState) => void;
}

/** Per-list selection the virtual list hands to message rows via context. */
export interface MessageRowSelectionProps {
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string, extend: boolean) => void;
}

export const kEmptyMessageSelection: MessageSelectionState = {
  selectedIds: new Set<string>(),
  lastToggledId: null,
};

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
  const fold = new MessageFold((row) => {
    // System messages never render as their own row; the merged system row
    // below stands in for all of them.
    if (row.message.role === "system") return;
    // The fold mints `msg-<position>` for id-less messages; a null id passes
    // the fold through and can't key a row, so it stays unselectable.
    const id = row.message.id;
    if (typeof id === "string") {
      rows.push({ id, messages: [row.message, ...row.toolMessages] });
    }
  });
  messages.forEach((message, index) => fold.next(message, index));
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

/** The selected messages, in chat order: each selected row contributes its
 *  head message plus the tool messages folded under it. */
export const resolveSelectedMessages = (
  index: ReadonlyMap<string, ChatMessage[]>,
  selectedIds: ReadonlySet<string>
): ChatMessage[] => {
  if (selectedIds.size === 0) return [];
  const messages: ChatMessage[] = [];
  for (const [id, rowMessages] of index) {
    if (selectedIds.has(id)) messages.push(...rowMessages);
  }
  return messages;
};

/** The selected ids that resolve, in chat order (e.g. for a print URL). */
export const resolveSelectedMessageIds = (
  index: ReadonlyMap<string, ChatMessage[]>,
  selectedIds: ReadonlySet<string>
): string[] => [...index.keys()].filter((id) => selectedIds.has(id));
