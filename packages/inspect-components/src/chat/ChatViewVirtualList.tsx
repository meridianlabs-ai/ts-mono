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
import { ContextProp, ItemProps, VirtuosoHandle } from "react-virtuoso";

import type { ChatMessage } from "@tsmono/inspect-common/types";
import { LiveVirtualList } from "@tsmono/react/components";
import { useListKeyboardNavigation } from "@tsmono/react/hooks";

import { ChatMessageRow } from "./ChatMessageRow";
import { ChatView } from "./ChatView";
import styles from "./ChatViewVirtualList.module.css";
import { ResolvedMessage, resolveMessages } from "./messages";
import { messageSearchText } from "./messageSearchText";
import {
  ChatViewDisplayOptions,
  ChatViewLabelOptions,
  ChatViewLinkingOptions,
  ChatViewToolOptions,
} from "./types";

export interface ChatViewVirtualListProps {
  id: string;
  messages: ChatMessage[];
  className?: string | string[];
  initialMessageId?: string | null;
  topOffset?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  running?: boolean;
  onNativeFindChanged?: (nativeFind: boolean) => void;
  display?: ChatViewDisplayOptions;
  labels?: ChatViewLabelOptions;
  linking?: ChatViewLinkingOptions;
  tools?: ChatViewToolOptions;
}

interface ChatViewVirtualListComponentProps extends ChatViewVirtualListProps {
  listHandle: RefObject<VirtuosoHandle | null>;
}

export const ChatViewVirtualList: FC<ChatViewVirtualListProps> = memo(
  function ChatViewVirtualList({
    id,
    messages,
    initialMessageId,
    topOffset,
    className,
    scrollRef,
    running,
    onNativeFindChanged,
    display,
    labels,
    linking,
    tools,
  }: ChatViewVirtualListProps) {
    // Support either virtualized or normal mode rendering based upon message count
    const useVirtuoso = running || messages.length > 200;
    const listHandle = useRef<VirtuosoHandle>(null);

    // Notify host app when native find availability changes
    useEffect(() => {
      onNativeFindChanged?.(!useVirtuoso);
    }, [onNativeFindChanged, useVirtuoso]);

    useListKeyboardNavigation({
      listHandle,
      scrollRef,
      itemCount: messages.length,
    });

    if (!useVirtuoso) {
      return (
        <ChatView
          id={id}
          messages={messages}
          className={className}
          display={display}
          labels={labels}
          linking={linking}
          tools={tools}
        />
      );
    } else {
      return (
        <ChatViewVirtualListComponent
          id={id}
          listHandle={listHandle}
          className={className}
          scrollRef={scrollRef}
          messages={messages}
          initialMessageId={initialMessageId}
          topOffset={topOffset}
          running={running}
          display={display}
          labels={labels}
          linking={linking}
          tools={tools}
        />
      );
    }
  }
);

/**
 * Renders the ChatViewVirtualList component.
 */
export const ChatViewVirtualListComponent: FC<ChatViewVirtualListComponentProps> =
  memo(function ChatViewVirtualListComponent({
    id,
    listHandle,
    messages,
    initialMessageId,
    topOffset,
    className,
    scrollRef,
    running,
    display,
    labels,
    linking,
    tools,
  }: ChatViewVirtualListComponentProps) {
    const resolveInto = tools?.resolveIntoPreviousMessage ?? true;
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

    const renderRow = useCallback(
      (index: number, item: ResolvedMessage): ReactNode => {
        return (
          <ChatMessageRow
            index={index}
            parentName={id || "chat-virtual-list"}
            resolvedMessage={item}
            highlightUserMessage={true}
            display={display}
            labels={labels}
            linking={linking}
            tools={tools}
          />
        );
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [id, collapsedMessages, display, labels, linking, tools]
    );

    const Item = ({
      children,
      ...props
    }: ItemProps<unknown> & ContextProp<unknown>) => {
      return (
        <div
          className={clsx(styles.item)}
          data-index={props["data-index"]}
          data-item-group-index={props["data-item-group-index"]}
          data-item-index={props["data-item-index"]}
          data-known-size={props["data-known-size"]}
          style={props.style}
        >
          {children}
        </div>
      );
    };

    return (
      <LiveVirtualList<ResolvedMessage>
        id="chat-virtual-list"
        listHandle={listHandle}
        className={className}
        scrollRef={scrollRef}
        data={collapsedMessages}
        renderRow={renderRow}
        initialTopMostItemIndex={initialMessageIndex}
        offsetTop={topOffset}
        live={running}
        showProgress={running}
        components={{ Item }}
        animation={false}
        itemSearchText={messageSearchText}
      />
    );
  });
