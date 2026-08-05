import type {
  ChatMessage,
  ChatMessageSystem,
} from "@tsmono/inspect-common/types";

import {
  mergedSystemMessage,
  Message,
  MessageFold,
  ResolvedMessage,
  resolveMessages,
} from "./messages";
import { ChatViewToolOptions } from "./types";

/** A folded chat row plus its whole-conversation numbering fact. */
export interface MessageRow {
  resolved: ResolvedMessage;
  /** Global sequential number of the row's first rendered block. */
  startNumber: number;
}

export interface MessageRowOptions {
  toolCallStyle: ChatViewToolOptions["callStyle"];
  collapseToolMessages: boolean;
}

/**
 * Fold options from a view's tool options — the one place the fold
 * defaults ("complete", collapse on) are defined. Data-layer folds and
 * the chat components both derive from here, so pre-built rows and their
 * rendering can't disagree on defaults.
 */
export const messageRowOptions = (
  tools?: Pick<ChatViewToolOptions, "callStyle" | "collapseToolMessages">
): MessageRowOptions => ({
  toolCallStyle: tools?.callStyle ?? "complete",
  collapseToolMessages: tools?.collapseToolMessages ?? true,
});

const numberRows = (
  resolved: ResolvedMessage[],
  startNumber: number,
  toolCallStyle: ChatViewToolOptions["callStyle"]
): MessageRow[] => {
  let next = startNumber;
  return resolved.map((row) => {
    const rowStart = next;
    next += countRowBlocks(row, toolCallStyle);
    return { resolved: row, startNumber: rowStart };
  });
};

/**
 * Fold messages into rows and attach start numbers — the whole-conversation
 * derivation the chat list renders from (tool folding, block prefix sums).
 * React-free so data-layer sources can build rows without dragging in
 * JSX/CSS modules.
 */
export const buildMessageRows = (
  messages: ChatMessage[],
  options: MessageRowOptions
): MessageRow[] =>
  numberRows(
    options.collapseToolMessages
      ? resolveMessages(messages)
      : messages.map((message) => ({ message, toolMessages: [] })),
    1,
    options.toolCallStyle
  );

/**
 * Fold a window of the conversation into rows — the windowed counterpart of
 * `buildMessageRows` for sources that never hold the whole conversation.
 *
 * `messages` must start at a row boundary (a non-tool message) and extend
 * to the next row boundary past the window's last row (or the conversation
 * end), so every row's tool run is complete. `baseIndex` is the
 * conversation position of `messages[0]` — minted ids are window-invariant
 * — and `startNumber` is the whole-conversation number of the first row's
 * first block (from a scan's prefix sums). System messages inside the
 * window fold as usual and are then dropped, matching the global fold,
 * which teleports their content into the merged first row
 * (`buildSystemMessageRow`); windows never contain that synthetic row.
 */
export const buildMessageRowsWindow = (
  messages: ChatMessage[],
  baseIndex: number,
  startNumber: number,
  options: MessageRowOptions
): MessageRow[] => {
  if (!options.collapseToolMessages) {
    return numberRows(
      messages.map((message) => ({ message, toolMessages: [] })),
      startNumber,
      options.toolCallStyle
    );
  }
  const resolved: ResolvedMessage[] = [];
  const fold = new MessageFold((row) => {
    if (row.message.role !== "system") {
      resolved.push(row);
    }
  });
  messages.forEach((message, i) => {
    fold.next(message, baseIndex + i);
  });
  fold.end();
  return numberRows(resolved, startNumber, options.toolCallStyle);
};

/**
 * The merged system row (row 0 of a collapse-on fold): every system
 * message's content, concatenated in conversation order. Undefined when
 * there is no system content — then the fold has no row 0 and numbering
 * starts at the first conversation row.
 */
export const buildSystemMessageRow = (
  systemMessages: ChatMessage[]
): MessageRow | undefined => {
  const merged = mergedSystemMessage(
    systemMessages.filter(
      (message): message is ChatMessageSystem => message.role === "system"
    )
  );
  return merged
    ? { resolved: { message: merged, toolMessages: [] }, startNumber: 1 }
    : undefined;
};

/** Per-row facts a scan retains: where the row starts and where its
 *  numbering begins. Everything else is re-derivable by re-folding the
 *  row's message window. */
export interface ScannedRowFact {
  /** Conversation position of the row's head (non-tool) message. */
  start: number;
  /** Numbering blocks rendered by every row before this one — the prefix
   *  sum a row's start number reads off directly. */
  blocksBefore: number;
}

/**
 * Streaming row discovery for windowed sources: feed messages in
 * conversation order and keep only row facts — never the messages. Block
 * counts depend only on a row's head message, so a row's fact is complete
 * the moment its head is seen; only the extent of its tool run stays open
 * until the next non-tool message (`completedRowCount`).
 */
export class MessageRowScanner {
  /** Facts for conversation rows (the merged system row is not among
   *  them — it is synthesized from `systemStarts` at serve time). */
  readonly rows: ScannedRowFact[] = [];
  /** Conversation positions of system messages seen so far. */
  readonly systemStarts: number[] = [];
  private systemContentItems = 0;
  private lastBoundary = -1;
  private blocksTotal = 0;

  constructor(private readonly options: MessageRowOptions) {}

  next(message: ChatMessage, index: number): void {
    if (!this.options.collapseToolMessages) {
      // no folding: every message is its own, immediately-complete row
      this.lastBoundary = index;
      this.pushRow(message, index);
      return;
    }
    if (message.role === "tool") {
      return;
    }
    this.lastBoundary = index;
    if (message.role === "system") {
      this.systemStarts.push(index);
      this.systemContentItems += Array.isArray(message.content)
        ? message.content.length
        : 1;
      return;
    }
    this.pushRow(message, index);
  }

  private pushRow(message: ChatMessage, index: number): void {
    // block counts depend only on the head message, so the prefix sum is
    // final the moment the row is discovered
    this.rows.push({ start: index, blocksBefore: this.blocksTotal });
    this.blocksTotal += countRowBlocks(
      { message, toolMessages: [] },
      this.options.toolCallStyle
    );
  }

  /** Whether the fold has a merged system row, given messages seen so
   *  far. A system message discovered later flips this — and shifts every
   *  row offset and number — which callers must treat as a (practically
   *  unseen) index invalidation. */
  get hasSystemRow(): boolean {
    return this.options.collapseToolMessages && this.systemContentItems > 0;
  }

  /**
   * Rows whose tool run is sealed by a later non-tool message. The last
   * discovered row stays open until one arrives — or `exhausted` says the
   * conversation ended. Without folding there are no tool runs, so every
   * row is complete on discovery.
   */
  completedRowCount(exhausted: boolean): number {
    if (
      !this.options.collapseToolMessages ||
      exhausted ||
      this.rows.length === 0
    ) {
      return this.rows.length;
    }
    const last = this.rows[this.rows.length - 1];
    return last && this.lastBoundary > last.start
      ? this.rows.length
      : this.rows.length - 1;
  }
}

export const hasVisibleContent = (message: Message): boolean => {
  const content = message.content;
  if (typeof content === "string") {
    return content.trim().length > 0;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((c) => {
    if (c.type === "tool_use") {
      // Server-side tool calls render as their own rows of the turn
      // container, so they make the message worth rendering.
      return true;
    }
    if (c.type === "text") {
      const hasText = c.text.trim().length > 0;
      const hasCitations = !!c.citations && c.citations.length > 0;
      return hasText || hasCitations;
    }
    if (c.type === "reasoning") {
      const hasReasoning = c.reasoning.trim().length > 0;
      const hasSummary = (c.summary?.trim().length ?? 0) > 0;
      // Empty redacted blocks (e.g. Google's position-only function_call
      // anchors with no signature) are pure structural metadata and have
      // nothing to display. Real encrypted-reasoning blocks (OpenAI
      // encrypted_content, Anthropic redacted-thinking) carry the encrypted
      // bytes in `reasoning` itself, so `hasReasoning` is true for them and
      // they remain visible.
      return hasReasoning || hasSummary;
    }
    return true;
  });
};

/**
 * Number of sequentially-numbered blocks a row renders. Only the full
 * (un-embedded) layout numbers tool calls individually; every other style
 * keeps the legacy one-number-per-row behavior.
 */
export const countRowBlocks = (
  resolved: ResolvedMessage,
  toolCallStyle: ChatViewToolOptions["callStyle"]
): number => {
  if (toolCallStyle !== "complete") return 1;
  const message = resolved.message;
  const hasToolCalls =
    message.role === "assistant" && !!message.tool_calls?.length;
  const skipChatMessage = hasToolCalls && !hasVisibleContent(message);
  return (
    (skipChatMessage ? 0 : 1) + (hasToolCalls ? message.tool_calls!.length : 0)
  );
};
