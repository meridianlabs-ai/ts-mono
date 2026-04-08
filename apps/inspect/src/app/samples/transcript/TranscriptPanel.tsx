import clsx from "clsx";
import {
  FC,
  memo,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { VirtuosoHandle } from "react-virtuoso";

import {
  computeTurnMap,
  flatTree as flattenTree,
  hasSpans,
  kSandboxSignalName,
  kTranscriptCollapseScope,
  kTranscriptOutlineCollapseScope,
  noScorerChildren,
  removeNodeVisitor,
  removeStepSpanNameVisitor,
  TranscriptVirtualList,
} from "@tsmono/inspect-components/transcript";
import { NoContentsPanel, StickyScroll } from "@tsmono/react/components";
import {
  useCollapsedState,
  useListKeyboardNavigation,
} from "@tsmono/react/hooks";

import { Events } from "../../../@types/extraInspect";
import { useStore } from "../../../state/store";
import { ApplicationIcons } from "../../appearance/icons";
import { useLogRouteParams } from "../../routing/url";

import { TranscriptOutline } from "./outline/TranscriptOutline";
import styles from "./TranscriptPanel.module.css";
import { useEventNodes } from "./transform/hooks";

interface TranscriptPanelProps {
  id: string;
  events: Events;
  scrollRef: RefObject<HTMLDivElement | null>;
  running?: boolean;
  initialEventId?: string | null;
  topOffset?: number;
  eventsCleared?: boolean;
}

/**
 * Renders the Transcript Virtual List.
 */
export const TranscriptPanel: FC<TranscriptPanelProps> = memo((props) => {
  let {
    id,
    scrollRef,
    events,
    running,
    initialEventId,
    topOffset,
    eventsCleared,
  } = props;

  // Sort out any types that are filtered out
  const filteredEventTypes = useStore(
    (state) => state.sample.eventFilter.filteredTypes
  );

  const sampleStatus = useStore((state) => state.sample.sampleStatus);

  // Apply the filter
  const filteredEvents = useMemo(() => {
    if (filteredEventTypes.length === 0) {
      return events;
    }
    return events.filter((event) => {
      return !filteredEventTypes.includes(event.event);
    });
  }, [events, filteredEventTypes]);

  // Convert to nodes
  const { eventNodes, defaultCollapsedIds } = useEventNodes(
    filteredEvents,
    running === true
  );

  // The list of events that have been collapsed
  const collapsedEvents = useStore((state) => state.sample.collapsedEvents);
  const setCollapsedEvents = useStore(
    (state) => state.sampleActions.setCollapsedEvents
  );
  const collapseEvent = useStore((state) => state.sampleActions.collapseEvent);

  const onCollapse = useCallback(
    (nodeId: string, collapsed: boolean) => {
      collapseEvent(kTranscriptCollapseScope, nodeId, collapsed);
    },
    [collapseEvent]
  );

  const getCollapsed = useCallback(
    (nodeId: string) => {
      return collapsedEvents?.[kTranscriptCollapseScope]?.[nodeId] === true;
    },
    [collapsedEvents]
  );

  const flattenedNodes = useMemo(() => {
    // flattten the event tree
    return flattenTree(
      eventNodes,
      (collapsedEvents
        ? collapsedEvents[kTranscriptCollapseScope]
        : undefined) || defaultCollapsedIds
    );
  }, [eventNodes, collapsedEvents, defaultCollapsedIds]);

  // Compute filtered node list for the outline (shared between outline and turn computation)
  // This ensures turn counts match between outline and main transcript
  const outlineFilteredNodes = useMemo(() => {
    return flattenTree(
      eventNodes,
      (collapsedEvents
        ? collapsedEvents[kTranscriptOutlineCollapseScope]
        : undefined) || defaultCollapsedIds,
      [
        // Strip specific nodes
        removeNodeVisitor("logger"),
        removeNodeVisitor("info"),
        removeNodeVisitor("state"),
        removeNodeVisitor("store"),
        removeNodeVisitor("approval"),
        removeNodeVisitor("input"),
        removeNodeVisitor("sandbox"),

        // Strip the sandbox wrapper (and children)
        removeStepSpanNameVisitor(kSandboxSignalName),

        // Remove child events for scorers
        noScorerChildren(),
      ]
    );
  }, [eventNodes, collapsedEvents, defaultCollapsedIds]);

  const turnMap = useMemo(
    () => computeTurnMap(outlineFilteredNodes, flattenedNodes),
    [outlineFilteredNodes, flattenedNodes]
  );

  // Update the collapsed events when the default collapsed IDs change
  // This effect only depends on defaultCollapsedIds, not eventNodes

  const collapsedMode = useStore((state) => state.sample.collapsedMode);

  useEffect(() => {
    if (events.length <= 0 || collapsedMode !== null) {
      return;
    }

    if (!collapsedEvents && Object.keys(defaultCollapsedIds).length > 0) {
      setCollapsedEvents(kTranscriptCollapseScope, defaultCollapsedIds);
    }
  }, [
    defaultCollapsedIds,
    collapsedEvents,
    setCollapsedEvents,
    events.length,
    collapsedMode,
  ]);

  const allNodesList = useMemo(() => {
    return flattenTree(eventNodes, null);
  }, [eventNodes]);

  useEffect(() => {
    if (events.length <= 0 || collapsedMode === null) {
      return;
    }

    const collapseIds: Record<string, boolean> = {};
    const collapsed = collapsedMode === "collapsed";

    allNodesList.forEach((node) => {
      if (
        node.event.uuid &&
        ((collapsed && !hasSpans(node.children.map((child) => child.event))) ||
          !collapsed)
      ) {
        collapseIds[node.event.uuid] = collapsedMode === "collapsed";
      }
    });

    setCollapsedEvents(kTranscriptCollapseScope, collapseIds);
  }, [collapsedMode, events, allNodesList, setCollapsedEvents]);

  const { logPath } = useLogRouteParams();
  const [collapsed, setCollapsed] = useCollapsedState(
    `transcript-panel-${logPath || "na"}`,
    false
  );

  const listHandle = useRef<VirtuosoHandle | null>(null);

  useListKeyboardNavigation({
    listHandle,
    scrollRef,
    itemCount: flattenedNodes.length,
  });

  if (sampleStatus === "loading" && flattenedNodes.length === 0) {
    return undefined;
  }

  if (flattenedNodes.length === 0) {
    const isCompletedFiltered =
      flattenedNodes.length === 0 && events.length > 0;
    const message = isCompletedFiltered
      ? "The currently applied filter hides all events."
      : eventsCleared
        ? "Transcript events were removed because this sample exceeds the browser's size limit. Use the Messages tab to view the conversation."
        : "No events to display.";
    return <NoContentsPanel text={message} />;
  } else {
    return (
      <div
        className={clsx(
          styles.container,
          collapsed ? styles.collapsed : undefined
        )}
      >
        <div className={styles.treeContainer}>
          <StickyScroll
            scrollRef={scrollRef}
            offsetTop={topOffset}
            className={styles.stickyOutline}
          >
            <TranscriptOutline
              className={clsx(styles.outline)}
              eventNodes={eventNodes}
              filteredNodes={outlineFilteredNodes}
              running={running}
              defaultCollapsedIds={defaultCollapsedIds}
              scrollRef={scrollRef}
            />
            <div
              className={styles.outlineToggle}
              onClick={() => setCollapsed(!collapsed)}
            >
              <i className={ApplicationIcons.sidebar} />
            </div>
          </StickyScroll>
        </div>

        <TranscriptVirtualList
          id={id}
          listHandle={listHandle}
          eventNodes={flattenedNodes}
          scrollRef={scrollRef}
          running={running}
          initialEventId={initialEventId === undefined ? null : initialEventId}
          offsetTop={topOffset}
          className={styles.listContainer}
          turnMap={turnMap}
          onCollapse={onCollapse}
          getCollapsed={getCollapsed}
        />
      </div>
    );
  }
});
