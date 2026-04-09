import clsx from "clsx";
import {
  CSSProperties,
  FC,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { VirtuosoHandle } from "react-virtuoso";

import { LiveVirtualList } from "@tsmono/react/components";

import { eventSearchText } from "./eventSearchText";
import { RenderedEventNode } from "./TranscriptVirtualList";
import styles from "./TranscriptVirtualListComponent.module.css";
import { EventNode, EventNodeContext, EventPanelCallbacks } from "./types";

interface TranscriptVirtualListComponentProps extends EventPanelCallbacks {
  id: string;
  listHandle: RefObject<VirtuosoHandle | null>;
  eventNodes: EventNode[];
  initialEventId?: string | null;
  offsetTop?: number;
  scrollRef?: RefObject<HTMLDivElement | null>;
  running?: boolean;
  className?: string | string[];
  turnMap?: Map<string, { turnNumber: number; totalTurns: number }>;
  disableVirtualization?: boolean;
  onNativeFindChanged?: (nativeFind: boolean) => void;
  onAutoCollapse?: (eventId: string) => void;
  renderAgentCard?: (
    node: EventNode,
    className?: string | string[]
  ) => ReactNode;
}

/**
 * Renders the Transcript component.
 */
export const TranscriptVirtualListComponent: FC<
  TranscriptVirtualListComponentProps
> = ({
  id,
  listHandle,
  eventNodes,
  scrollRef,
  running,
  initialEventId,
  offsetTop,
  className,
  turnMap,
  disableVirtualization,
  onNativeFindChanged,
  onAutoCollapse,
  renderAgentCard,
  onCollapse,
  getCollapsed,
  getEventUrl,
  linkingEnabled,
}) => {
  const useVirtualization =
    !disableVirtualization && (running || eventNodes.length > 100);

  useEffect(() => {
    onNativeFindChanged?.(!useVirtualization);
  }, [onNativeFindChanged, useVirtualization]);

  // Resolve the deep-link event ID to an index only when the ID itself
  // changes, not when eventNodes changes due to filtering. This prevents
  // filter changes from re-triggering scroll-to-index in LiveVirtualList.
  const [initialEventIndex, setInitialEventIndex] = useState<
    number | undefined
  >(() => {
    if (initialEventId === null || initialEventId === undefined)
      return undefined;
    const idx = eventNodes.findIndex((e) => e.id === initialEventId);
    return idx === -1 ? undefined : idx;
  });

  useEffect(() => {
    if (initialEventId === null || initialEventId === undefined) {
      setInitialEventIndex(undefined);
      return;
    }
    const idx = eventNodes.findIndex((e) => e.id === initialEventId);
    setInitialEventIndex(idx === -1 ? undefined : idx);
    // Only re-resolve when the deep-link ID changes, not on data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEventId]);

  const hasToolEventsAtCurrentDepth = useCallback(
    (startIndex: number) => {
      const startNode = eventNodes[startIndex];
      if (!startNode) return false;
      // Walk backwards from this index to see if we see any tool events
      // at this depth, prior to this event
      for (let i = startIndex; i >= 0; i--) {
        const node = eventNodes[i];
        if (!node) return false;

        if (node.event.event === "tool") {
          return true;
        }
        if (node.depth < startNode.depth) {
          return false;
        }
      }
      return false;
    },
    [eventNodes]
  );

  // Non-virtual scroll-into-view for initial event
  const nonVirtualGridRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!useVirtualization && initialEventId) {
      const row = nonVirtualGridRef.current?.querySelector(
        `[id="${initialEventId}"]`
      );
      row?.scrollIntoView({ block: "start" });
    }
  }, [initialEventId, useVirtualization]);

  // Pre-compute context objects for all event nodes to maintain stable references
  const contextMap = useMemo(() => {
    const map = new Map<string, EventNodeContext>();
    for (const [i, node] of eventNodes.entries()) {
      const hasToolEvents = hasToolEventsAtCurrentDepth(i);
      const turnInfo = turnMap?.get(node.id);
      map.set(node.id, { hasToolEvents, turnInfo });
    }
    return map;
  }, [eventNodes, hasToolEventsAtCurrentDepth, turnMap]);

  const renderRow = useCallback(
    (index: number, item: EventNode, style?: CSSProperties) => {
      const paddingClass = index === 0 ? styles.first : undefined;

      const previousIndex = index - 1;
      const nextIndex = index + 1;
      const previous =
        previousIndex > 0 && previousIndex <= eventNodes.length
          ? eventNodes[previousIndex]
          : undefined;
      const next =
        nextIndex < eventNodes.length ? eventNodes[nextIndex] : undefined;
      const attached =
        item.event.event === "tool" &&
        (previous?.event.event === "tool" || previous?.event.event === "model");

      const attachedParent =
        item.event.event === "model" && next?.event.event === "tool";
      const attachedClass = attached ? styles.attached : undefined;
      const attachedChildClass = attached ? styles.attachedChild : undefined;
      const attachedParentClass = attachedParent
        ? styles.attachedParent
        : undefined;

      const context = contextMap.get(item.id);
      const isLast = index === eventNodes.length - 1;

      return (
        <div
          id={item.id}
          key={item.id}
          className={clsx(
            styles.node,
            paddingClass,
            isLast ? styles.last : undefined,
            attachedClass
          )}
          style={{
            ...style,
            paddingLeft: `${item.depth <= 1 ? item.depth * 0.7 : (0.7 + item.depth - 1) * 1}em`,
            paddingRight: `${item.depth === 0 ? undefined : ".7em"} `,
          }}
        >
          <RenderedEventNode
            node={item}
            next={next}
            className={clsx(attachedParentClass, attachedChildClass)}
            context={context}
            onAutoCollapse={onAutoCollapse}
            renderAgentCard={renderAgentCard}
            onCollapse={onCollapse}
            getCollapsed={getCollapsed}
            getEventUrl={getEventUrl}
            linkingEnabled={linkingEnabled}
          />
        </div>
      );
    },
    [
      eventNodes,
      contextMap,
      onAutoCollapse,
      renderAgentCard,
      onCollapse,
      getCollapsed,
      getEventUrl,
      linkingEnabled,
    ]
  );

  if (useVirtualization) {
    return (
      <LiveVirtualList<EventNode>
        listHandle={listHandle}
        className={className}
        id={id}
        scrollRef={scrollRef}
        data={eventNodes}
        initialTopMostItemIndex={initialEventIndex}
        offsetTop={offsetTop}
        renderRow={renderRow}
        live={running}
        animation={!!running}
        itemSearchText={eventSearchText}
      />
    );
  } else {
    return (
      <div ref={nonVirtualGridRef}>
        {eventNodes.map((node, index) => {
          const row = renderRow(index, node, {
            scrollMarginTop: offsetTop,
          });
          return row;
        })}
      </div>
    );
  }
};
