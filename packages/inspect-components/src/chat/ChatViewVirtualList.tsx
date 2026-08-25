import clsx from "clsx";
import {
  FC,
  memo,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ChatMessage } from "@tsmono/inspect-common/types";
import { NoContentsPanel } from "@tsmono/react/components";
import {
  FindAnchorContainer,
  useFindSurface,
  type FindMatch,
  type FindSurface,
  type RevealOutcome,
} from "@tsmono/react/find";
import { useListKeyboardNavigation } from "@tsmono/react/hooks";
import { VirtualList } from "@tsmono/react/virtual";
import type {
  VirtualListHandle,
  VirtualListItemProps,
} from "@tsmono/react/virtual";

import { createMessageRowsFindSource, MESSAGES_FIND_SCOPE } from "../find";
import { GeneratingIndicator } from "../indicators/GeneratingIndicator";
import {
  isLivePlaceholderMessage,
  isToolExecutingMessage,
} from "../indicators/livePlaceholder";
import { LoadingEventsIndicator } from "../indicators/LoadingEventsIndicator";

import { ChatMessageRow } from "./ChatMessageRow";
import styles from "./ChatViewVirtualList.module.css";
import { computeMaxLabelLength } from "./labelLength";
import { messageSearchText } from "./messageSearchText";
import {
  buildMessageRows,
  messageRowOptions,
  rowContainsMessage,
  type MessageRow,
} from "./rowsModel";
import {
  ChatViewDisplayOptions,
  ChatViewLabelOptions,
  ChatViewLinkingOptions,
  ChatViewToolOptions,
} from "./types";

// Stable Item wrapper defined at module scope so its identity is constant
// across re-renders — a new component identity each render forces the
// virtualizer to re-mount every row and detaches any active find-selection.
const ChatItem = ({ children, ...props }: VirtualListItemProps) => {
  return (
    <div
      data-index={props["data-index"]}
      data-item-index={props["data-item-index"]}
      data-known-size={props["data-known-size"]}
      style={props.style}
    >
      {children}
    </div>
  );
};

const chatComponents = { Item: ChatItem };

// Frame budget for a scrolled-to row to mount; matches the transcript
// surface's reveal budget.
const ANCHOR_DOM_BUDGET = 30;

function raf(): Promise<void> {
  return new Promise((resolve) =>
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame(() => resolve())
      : setTimeout(resolve, 0)
  );
}

const escapeAttr = (id: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- CSS.escape is missing in some embedder hosts
  typeof CSS !== "undefined" && CSS.escape
    ? CSS.escape(id)
    : id.replace(/"/g, '\\"');

async function waitForAnchorInDOM(
  anchorId: string,
  signal: AbortSignal
): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const selector = `[data-find-anchor="${escapeAttr(anchorId)}"]`;
  for (let i = 0; i < ANCHOR_DOM_BUDGET; i++) {
    if (signal.aborted) return false;
    if (document.querySelector(selector)) return true;
    await raf();
  }
  return false;
}

// Empirically tuned, sign-inverted vs naive TanStack math; don't "fix" without re-verifying against both chat and transcript surfaces.
const kChatScrollPaddingStart = -15;

// How close (in rows) the viewport gets to the loaded end before the next
// page is requested — roughly a viewport of chat rows, so the fetch usually
// lands before the user reaches the footer.
const kLoadMoreMarginRows = 20;

export interface ChatViewRowsVirtualListProps {
  id: string;
  rows: MessageRow[];
  /** A paged host's signal that `rows` is a loaded prefix, not the whole
   *  conversation: keeps a loading footer below the list and arms the
   *  near-end trigger. */
  hasMoreRows?: boolean;
  /** Request the page after `rows`. Called whenever the viewport nears the
   *  loaded end — possibly repeatedly, so the host owns the in-flight
   *  guard. */
  onLoadMoreRows?: () => void;
  className?: string | string[];
  initialMessageId?: string | null;
  /** Explicit `follow=1` URL param: arm live-tail at mount even on a
   *  `?message=` landing, matching the transcript tab. */
  followRequested?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  running?: boolean;
  backfilling?: boolean;
  /** Whether a live→finished transition may scroll the view to the top.
   *  Hosts pass false for unsuccessful finishes (error/cancelled): the
   *  error panel renders at the bottom, where the user is looking. */
  scrollToTopOnFinish?: boolean;
  onNativeFindChanged?: (nativeFind: boolean) => void;
  display?: ChatViewDisplayOptions;
  labels?: ChatViewLabelOptions;
  linking?: ChatViewLinkingOptions;
  tools?: ChatViewToolOptions;
}

/**
 * The chat list over prebuilt rows — hosts that source rows from a data
 * layer render through this; the message-array wrapper below covers callers
 * that still hold raw messages.
 */
export const ChatViewRowsVirtualList: FC<ChatViewRowsVirtualListProps> = memo(
  function ChatViewRowsVirtualList({
    id,
    rows,
    hasMoreRows,
    onLoadMoreRows,
    initialMessageId,
    followRequested,
    className,
    scrollRef,
    running,
    backfilling,
    scrollToTopOnFinish = true,
    onNativeFindChanged,
    display,
    labels,
    linking,
    tools,
  }: ChatViewRowsVirtualListProps) {
    const listHandle = useRef<VirtualListHandle>(null);

    // Frozen at mount, mirroring TranscriptViewNodes: a ?message= landing owns
    // the scroll position, so follow must not auto-arm from a live sample.
    const [navOwned] = useState(() => !!initialMessageId);

    useEffect(() => {
      onNativeFindChanged?.(false);
    }, [onNativeFindChanged]);

    useListKeyboardNavigation({
      listHandle,
      scrollRef,
      itemCount: rows.length,
    });

    // ---- Find surface (scope "messages") --------------------------------
    const source = useMemo(() => createMessageRowsFindSource(rows), [rows]);
    // reveal() runs across awaits; a ref so a page landing mid-reveal is seen.
    const rowsRef = useRef(rows);
    useEffect(() => {
      rowsRef.current = rows;
    }, [rows]);
    const reveal = useCallback(
      async (match: FindMatch, signal: AbortSignal): Promise<RevealOutcome> => {
        const currentRows = rowsRef.current;
        const anchorId = match.anchor.id;
        const hinted = match.ordinal;
        const index =
          hinted !== undefined &&
          currentRows[hinted]?.resolved.message.id === anchorId
            ? hinted
            : currentRows.findIndex((r) => r.resolved.message.id === anchorId);
        if (index < 0) return "missing";
        listHandle.current?.scrollToIndex({ index, align: "center" });
        const mounted = await waitForAnchorInDOM(anchorId, signal);
        return mounted ? "revealed" : "missing";
      },
      []
    );
    const surface = useMemo<FindSurface>(
      () => ({ scopeId: MESSAGES_FIND_SCOPE, source, reveal }),
      [source, reveal]
    );
    useFindSurface(surface);

    // The near-end trigger re-checks on scroll AND when rows grow: a landing
    // page doesn't move the viewport, so the rows-grow case rides on
    // VirtualList replaying the current range whenever this callback's
    // identity (here, `rows.length`) changes — a user parked at the loaded
    // end keeps paging without scrolling.
    const handleVisibleRangeChange = useCallback(
      (range: { startIndex: number; endIndex: number }) => {
        if (
          hasMoreRows &&
          onLoadMoreRows &&
          range.endIndex >= rows.length - kLoadMoreMarginRows
        ) {
          onLoadMoreRows();
        }
      },
      [hasMoreRows, onLoadMoreRows, rows.length]
    );

    const initialMessageIndex = useMemo(() => {
      if (initialMessageId === null || initialMessageId === undefined) {
        return undefined;
      }

      const index = rows.findIndex((row) =>
        rowContainsMessage(row, initialMessageId)
      );
      return index !== -1 ? index : undefined;
    }, [initialMessageId, rows]);

    const maxLabelLength = useMemo(
      () => computeMaxLabelLength(labels?.messageLabels),
      [labels?.messageLabels]
    );

    const lastIndex = rows.length - 1;
    const renderRow = useCallback(
      (index: number, item: MessageRow): ReactNode => {
        if (
          running &&
          index === lastIndex &&
          isLivePlaceholderMessage(item.resolved.message)
        ) {
          return (
            <div className={styles.generatingRow}>
              {backfilling ? (
                <LoadingEventsIndicator label="Loading messages" />
              ) : (
                <GeneratingIndicator />
              )}
            </div>
          );
        }
        const toolExecuting =
          running &&
          index === lastIndex &&
          isToolExecutingMessage(
            item.resolved.message,
            item.resolved.toolMessages.length
          );
        // The anchor wrapper carries the row's find highlights and lets
        // reveal() detect the row has mounted (data-find-anchor).
        return (
          <FindAnchorContainer anchorId={item.resolved.message.id ?? null}>
            <ChatMessageRow
              index={index}
              parentName={id || "chat-virtual-list"}
              resolvedMessage={item.resolved}
              display={display}
              labels={labels}
              linking={linking}
              tools={tools}
              maxLabelLength={maxLabelLength}
              startNumber={item.startNumber}
            />
            {toolExecuting ? (
              <div className={styles.generatingRow}>
                {backfilling ? (
                  <LoadingEventsIndicator label="Loading messages" />
                ) : (
                  <GeneratingIndicator label="running" />
                )}
              </div>
            ) : null}
          </FindAnchorContainer>
        );
      },
      [
        id,
        running,
        backfilling,
        lastIndex,
        display,
        labels,
        linking,
        tools,
        maxLabelLength,
      ]
    );

    const rowSearchText = useCallback(
      (item: MessageRow): string | string[] => messageSearchText(item.resolved),
      []
    );

    // Show a placeholder instead of a blank tab when there's nothing to
    // render: a running sample may have no messages yet (before its first
    // message event arrives), and a finished one may be empty (e.g. an early
    // error, or messages cleared due to size limits).
    if (rows.length === 0) {
      if (backfilling) {
        return <LoadingEventsIndicator label="Loading messages" />;
      }
      return running ? (
        <NoContentsPanel text="Waiting for messages" busy />
      ) : (
        <NoContentsPanel text="No messages" />
      );
    }

    return (
      <VirtualList<MessageRow>
        persistenceKey={`chat-${id}`}
        ref={listHandle}
        className={clsx(styles.list, className)}
        scrollRef={scrollRef}
        data={rows}
        renderRow={renderRow}
        initialIndex={initialMessageIndex}
        scrollPaddingStart={kChatScrollPaddingStart}
        live={running}
        navOwned={navOwned}
        followRequested={followRequested}
        scrollToTopOnFinish={scrollToTopOnFinish}
        components={chatComponents}
        smoothScroll={false}
        itemSearchText={rowSearchText}
        showProgress={hasMoreRows}
        onVisibleRangeChange={handleVisibleRangeChange}
      />
    );
  }
);

export interface ChatViewVirtualListProps extends Omit<
  ChatViewRowsVirtualListProps,
  "rows"
> {
  messages: ChatMessage[];
}

/** The chat list over an in-memory message array. */
export const ChatViewVirtualList: FC<ChatViewVirtualListProps> = memo(
  function ChatViewVirtualList({ messages, tools, ...rest }) {
    const callStyle = tools?.callStyle;
    const collapseToolMessages = tools?.collapseToolMessages;
    const rows = useMemo(
      () =>
        buildMessageRows(
          messages,
          messageRowOptions({ callStyle, collapseToolMessages })
        ),
      [messages, callStyle, collapseToolMessages]
    );
    return <ChatViewRowsVirtualList rows={rows} tools={tools} {...rest} />;
  }
);
