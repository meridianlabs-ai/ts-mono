import clsx from "clsx";
import {
  FC,
  memo,
  ReactElement,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";

import type { ChatMessage } from "@tsmono/inspect-common/types";
import { NoContentsPanel } from "@tsmono/react/components";
import { useListKeyboardNavigation } from "@tsmono/react/hooks";
import { VirtualList } from "@tsmono/react/virtual";
import type {
  VirtualListHandle,
  VirtualListItemProps,
} from "@tsmono/react/virtual";

import { GeneratingIndicator } from "../indicators/GeneratingIndicator";
import {
  isLivePlaceholderMessage,
  isToolExecutingMessage,
} from "../indicators/livePlaceholder";
import { LoadingEventsIndicator } from "../indicators/LoadingEventsIndicator";

import { ChatMessageRow, countRowBlocks } from "./ChatMessageRow";
import styles from "./ChatViewVirtualList.module.css";
import { computeMaxLabelLength } from "./labelLength";
import { ResolvedMessage, resolveMessages } from "./messages";
import { messageSearchText } from "./messageSearchText";
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
      className={clsx(styles.item)}
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

export interface ChatViewVirtualListProps {
  id: string;
  messages: ChatMessage[];
  className?: string | string[];
  initialMessageId?: string | null;
  offsetTop?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  running?: boolean;
  backfilling?: boolean;
  onNativeFindChanged?: (nativeFind: boolean) => void;
  display?: ChatViewDisplayOptions;
  labels?: ChatViewLabelOptions;
  linking?: ChatViewLinkingOptions;
  tools?: ChatViewToolOptions;
}

export const ChatViewVirtualList: FC<ChatViewVirtualListProps> = memo(
  function ChatViewVirtualList({
    id,
    messages,
    initialMessageId,
    offsetTop,
    className,
    scrollRef,
    running,
    backfilling,
    onNativeFindChanged,
    display,
    labels,
    linking,
    tools,
  }: ChatViewVirtualListProps) {
    const listHandle = useRef<VirtualListHandle>(null);

    useEffect(() => {
      onNativeFindChanged?.(false);
    }, [onNativeFindChanged]);

    useListKeyboardNavigation({
      listHandle,
      scrollRef,
      itemCount: messages.length,
    });

    const resolveInto = tools?.collapseToolMessages ?? true;
    const collapsedMessages = useMemo(() => {
      return resolveInto
        ? resolveMessages(messages)
        : messages.map((msg) => ({
            message: msg,
            toolMessages: [],
          }));
    }, [resolveInto, messages]);

    const initialMessageIndex = useMemo(() => {
      if (initialMessageId === null || initialMessageId === undefined) {
        return undefined;
      }

      const index = collapsedMessages.findIndex((message) => {
        const messageId = message.message.id === initialMessageId;
        if (messageId) {
          return true;
        }

        if (message.toolMessages.find((tm) => tm.id === initialMessageId)) {
          return true;
        }
      });
      return index !== -1 ? index : undefined;
    }, [initialMessageId, collapsedMessages]);

    const maxLabelLength = useMemo(
      () => computeMaxLabelLength(labels?.messageLabels),
      [labels?.messageLabels]
    );

    const toolCallStyle = tools?.callStyle ?? "complete";
    const rowStartNumbers = useMemo(() => {
      const starts: number[] = [];
      let next = 1;
      for (const msg of collapsedMessages) {
        starts.push(next);
        next += countRowBlocks(msg, toolCallStyle);
      }
      return starts;
    }, [collapsedMessages, toolCallStyle]);

    const lastIndex = collapsedMessages.length - 1;
    const renderRow = useCallback(
      (index: number, item: ResolvedMessage): ReactNode => {
        if (
          running &&
          index === lastIndex &&
          isLivePlaceholderMessage(item.message)
        ) {
          return (
            <div className={styles.generatingRow}>
              {renderChatLiveIndicator(backfilling === true)}
            </div>
          );
        }
        const toolExecuting =
          running &&
          index === lastIndex &&
          isToolExecutingMessage(item.message, item.toolMessages.length);
        return (
          <>
            <ChatMessageRow
              index={index}
              parentName={id || "chat-virtual-list"}
              resolvedMessage={item}
              display={display}
              labels={labels}
              linking={linking}
              tools={tools}
              maxLabelLength={maxLabelLength}
              startNumber={rowStartNumbers[index]}
            />
            {toolExecuting ? (
              <div className={styles.generatingRow}>
                {renderChatLiveIndicator(backfilling === true, "running")}
              </div>
            ) : null}
          </>
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
        rowStartNumbers,
      ]
    );

    // Show a placeholder instead of a blank tab when there's nothing to
    // render: a running sample may have no messages yet (before its first
    // message event arrives), and a finished one may be empty (e.g. an early
    // error, or messages cleared due to size limits).
    if (collapsedMessages.length === 0) {
      return renderChatEmptyState({
        running: running === true,
        backfilling: backfilling === true,
      });
    }

    return (
      <VirtualList<ResolvedMessage>
        persistenceKey={`chat-${id}`}
        ref={listHandle}
        className={clsx(styles.list, className)}
        scrollRef={scrollRef}
        data={collapsedMessages}
        renderRow={renderRow}
        initialIndex={initialMessageIndex}
        stickyHeaderOffset={offsetTop}
        live={running}
        scrollToTopOnFinish={true}
        components={chatComponents}
        smoothScroll={false}
        itemSearchText={messageSearchText}
      />
    );
  }
);

export const renderChatLiveIndicator = (
  backfilling: boolean,
  generatingLabel?: string
): ReactElement =>
  backfilling ? (
    <LoadingEventsIndicator label="Loading messages" />
  ) : (
    <GeneratingIndicator label={generatingLabel} />
  );

export const renderChatEmptyState = ({
  running,
  backfilling,
}: {
  running: boolean;
  backfilling: boolean;
}): ReactElement => {
  if (backfilling) {
    return <LoadingEventsIndicator label="Loading messages" />;
  }
  if (running) {
    return <NoContentsPanel text="Waiting for messages" busy />;
  }
  return <NoContentsPanel text="No messages" />;
};
