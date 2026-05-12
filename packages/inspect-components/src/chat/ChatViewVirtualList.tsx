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

// Stable Virtuoso Item wrapper. Defined at module scope so its identity
// doesn't change across renders of ChatViewVirtualList — Virtuoso
// re-mounts every row when `components.Item` is a new ref, which detaches
// the text node any active find selection is anchored to and silently
// collapses the highlight after about a second of settling.
const ChatVirtuosoItem = ({
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

const chatVirtuosoComponents = { Item: ChatVirtuosoItem };

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
    const listHandle = useRef<VirtuosoHandle>(null);

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

    const renderRow = useCallback(
      (index: number, item: ResolvedMessage): ReactNode => {
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
          />
        );
      },
      [id, display, labels, linking, tools, maxLabelLength]
    );

    return (
      <LiveVirtualList<ResolvedMessage>
        id="chat-virtual-list"
        listHandle={listHandle}
        className={className}
        scrollRef={scrollRef}
        data={collapsedMessages}
        renderRow={renderRow}
        initialTopMostItemIndex={initialMessageIndex}
        offsetTop={offsetTop}
        live={running}
        showProgress={running}
        components={chatVirtuosoComponents}
        animation={false}
        itemSearchText={messageSearchText}
      />
    );
  }
);
