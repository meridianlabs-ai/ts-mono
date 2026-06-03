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
} from "react";

import type { ChatMessage } from "@tsmono/inspect-common/types";
import { useListKeyboardNavigation } from "@tsmono/react/hooks";
import { VirtualList } from "@tsmono/react/virtual";
import type {
  VirtualListHandle,
  VirtualListItemProps,
} from "@tsmono/react/virtual";

import { GeneratingIndicator } from "../indicators/GeneratingIndicator";
import { isLivePlaceholderMessage } from "../indicators/livePlaceholder";

import { ChatMessageRow, countRowBlocks } from "./ChatMessageRow";
import styles from "./ChatViewVirtualList.module.css";
import { computeMaxLabelLength } from "./labelLength";
import { MessageLabel } from "./MessageLabel";
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
              <div className={styles.generatingContent}>
                <GeneratingIndicator />
              </div>
              <div
                className={styles.generatingLabel}
                style={{ minWidth: `${maxLabelLength ?? 3}ch` }}
              >
                <MessageLabel label={`${index + 1}`} />
              </div>
            </div>
          );
        }
        return (
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
        );
      },
      [
        id,
        running,
        lastIndex,
        display,
        labels,
        linking,
        tools,
        maxLabelLength,
        rowStartNumbers,
      ]
    );

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
