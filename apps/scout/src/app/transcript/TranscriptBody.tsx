import clsx from "clsx";
import {
  FC,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  ChatViewVirtualList,
  messagesToStr,
} from "@tsmono/inspect-components/chat";
import {
  DisplayModeContext,
  MetaDataGrid,
} from "@tsmono/inspect-components/content";
import type { TranscriptLayoutRightRailProps } from "@tsmono/inspect-components/transcript";
import type { SearchScope as TranscriptSearchScope } from "@tsmono/inspect-components/transcript-search";
import {
  ActivityRail,
  RailDock,
  TabPanel,
  TabSet,
  ToolButton,
  ToolDropdownButton,
  type ActivityRailItem,
} from "@tsmono/react/components";
import {
  navigateAndForget,
  useProperty,
  useReflectEventNavigationInUrl,
  useVisitId,
} from "@tsmono/react/hooks";
import { formatDateTime, isHostedEnvironment } from "@tsmono/util";

import { ApplicationIcons } from "../../icons";
import {
  getRailParam,
  nextRailValue,
  updateRailParam,
  type RailPanelId,
} from "../../router/url";
import { useStore } from "../../state/store";
import { Transcript } from "../../types/api-types";
import { TimelineEventsView } from "../timeline/components/TimelineEventsView";
import { useTranscriptsDir } from "../utils/useTranscriptsDir";
import { ValidationCaseEditor } from "../validation/components/ValidationCaseEditor";

import { useSearchReferenceLabels } from "./hooks/useSearchReferenceLabels";
import { useTranscriptColumnFilter } from "./hooks/useTranscriptColumnFilter";
import { useTranscriptNavigation } from "./hooks/useTranscriptNavigation";
import { SearchPanel } from "./SearchPanel";
import styles from "./TranscriptBody.module.css";
import { TranscriptFilterPopover } from "./TranscriptFilterPopover";

export const kTranscriptMessagesTabId = "transcript-messages";
export const kTranscriptEventsTabId = "transcript-events";
export const kTranscriptMetadataTabId = "transcript-metadata";
export const kTranscriptInfoTabId = "transcript-info";

interface TranscriptBodyProps {
  transcript: Transcript;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Headroom direction signal: true = scrolling down (hide). */
  headroomHidden?: boolean;
  /** Reset the headroom anchor before a layout shift or programmatic scroll.
   *  Pass `true` to debounce (keeps lock alive while scrolling continues). */
  onHeadroomResetAnchor?: (debounce?: boolean) => void;
  /** Force the chrome (title headroom + swimlanes) shown/hidden. Every call
   *  claims nav ownership of the chrome — see TranscriptPanel. */
  onHeadroomSetHidden?: (hidden: boolean) => void;
}

export const TranscriptBody: FC<TranscriptBodyProps> = ({
  transcript,
  scrollRef,
  headroomHidden,
  onHeadroomResetAnchor,
  onHeadroomSetHidden,
}) => {
  const navigate = useNavigate();
  const { resolvedTranscriptsDir } = useTranscriptsDir(true);

  // Measure tab bar height so downstream sticky offsets align exactly
  // with the tab bar bottom, avoiding sub-pixel gaps from a hardcoded value.
  const tabsRef = useRef<HTMLUListElement | null>(null);
  const [tabBarHeight, setTabBarHeight] = useState(40);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setTabBarHeight(el.getBoundingClientRect().height);
    });
    observer.observe(el);
    setTabBarHeight(el.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();
  const {
    getEventUrl,
    getFullEventUrl,
    getFullMessageUrl,
    getEventFocusUrl,
    onOpenEventFocus,
  } = useTranscriptNavigation();
  const tabParam = searchParams.get("tab");

  // Get event or message ID from query params for deep linking
  const eventParam = searchParams.get("event");
  const messageParam = searchParams.get("message");

  // Scope the Events/Messages VirtualList persistence keys by VISIT: tab
  // flips within one visit share the key (flipping back restores the scroll
  // position), but a sibling hop or a later return to this transcript is a
  // new visit — its lists mount with fresh keys and open at the top instead
  // of restoring an earlier visit's offset.
  const visitId = useVisitId(transcript.transcript_id);

  // Selected tab — default to Events when the transcript has events
  const hasEvents = transcript.events && transcript.events.length > 0;
  const defaultTab = hasEvents
    ? kTranscriptEventsTabId
    : kTranscriptMessagesTabId;
  const selectedTranscriptTab = useStore(
    (state) => state.selectedTranscriptTab
  );
  const setSelectedTranscriptTab = useStore(
    (state) => state.setSelectedTranscriptTab
  );
  const resolvedSelectedTranscriptTab =
    tabParam || selectedTranscriptTab || defaultTab;
  const searchScope: TranscriptSearchScope | undefined =
    resolvedSelectedTranscriptTab === kTranscriptMessagesTabId
      ? "messages"
      : resolvedSelectedTranscriptTab === kTranscriptEventsTabId
        ? "events"
        : undefined;

  // Labels track the active tab's search scope so each tab shows the cites
  // from its own results. `?? "events"` only feeds the hook a stable scope
  // when no tab is searchable; searchId resolution still yields no labels.
  const referenceLabels = useSearchReferenceLabels({
    scope: searchScope ?? "events",
    transcriptDir: resolvedTranscriptsDir,
    transcriptId: transcript.transcript_id,
  });
  const eventsReferenceLabels =
    searchScope === "events" ? referenceLabels : undefined;
  const messagesReferenceLabels =
    searchScope === "messages" ? referenceLabels : undefined;

  const handleTabChange = useCallback(
    (tabId: string) => {
      //  update both store and URL
      setSelectedTranscriptTab(tabId);
      setSearchParams((prevParams) => {
        const newParams = new URLSearchParams(prevParams);
        newParams.set("tab", tabId);
        // Clear deep link params so the auto-switch effect doesn't
        // fight the user's explicit tab choice
        newParams.delete("event");
        newParams.delete("message");
        return newParams;
      });
    },
    [setSelectedTranscriptTab, setSearchParams]
  );

  const onNavigatedToEvent = useReflectEventNavigationInUrl(setSearchParams);

  // Navigate to a specific event when a marker is clicked on the timeline.
  // When selectedKey is provided (compaction markers), the bar is selected
  // atomically in the same URL update to avoid a race between setSearchParams
  // and navigate.
  const handleMarkerNavigate = useCallback(
    (eventId: string, selectedKey?: string) => {
      const url = getEventUrl(eventId, selectedKey);
      if (!url) return;
      navigateAndForget(navigate, url, { replace: true });
    },
    [getEventUrl, navigate]
  );

  // Auto-switch tab based on deep link params
  useEffect(() => {
    const targetTab = eventParam
      ? kTranscriptEventsTabId
      : messageParam && !tabParam
        ? kTranscriptMessagesTabId
        : null;
    if (!targetTab || resolvedSelectedTranscriptTab === targetTab) return;
    setSelectedTranscriptTab(targetTab);
    setSearchParams((prevParams) => {
      const newParams = new URLSearchParams(prevParams);
      newParams.set("tab", targetTab);
      return newParams;
    });
  }, [
    eventParam,
    messageParam,
    tabParam,
    resolvedSelectedTranscriptTab,
    setSelectedTranscriptTab,
    setSearchParams,
  ]);

  // Transcript Filtering
  const transcriptFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const [transcriptFilterShowing, setTranscriptFilterShowing] = useState(false);
  const toggleTranscriptFilterShowing = useCallback(() => {
    setTranscriptFilterShowing((prev) => !prev);
  }, []);
  const { excludedEventTypes, isDebugFilter, isDefaultFilter } =
    useTranscriptColumnFilter();

  // Pre-filter events by excluded types before feeding into the timeline pipeline
  const filteredEvents = useMemo(() => {
    if (excludedEventTypes.length === 0) return transcript.events;
    return transcript.events.filter(
      (event) => !excludedEventTypes.includes(event.event)
    );
  }, [transcript.events, excludedEventTypes]);

  // Transcript collapse (toolbar button state)
  const eventsCollapsed = useStore((state) => state.transcriptState.collapsed);
  const setTranscriptState = useStore((state) => state.setTranscriptState);
  const collapseEvents = useCallback(
    (collapsed: boolean) => {
      setTranscriptState((prev) => ({
        ...prev,
        collapsed,
      }));
    },
    [setTranscriptState]
  );

  // The rail (Search / Validation) is mutually exclusive; the URL is the
  // source of truth. The panel docks to the right of content on the Messages
  // and Events tabs only.
  const activeRail = getRailParam(searchParams) ?? null;

  const onRailSelect = useCallback(
    (id: RailPanelId) => {
      setSearchParams((prev) =>
        updateRailParam(prev, nextRailValue(getRailParam(prev), id))
      );
    },
    [setSearchParams]
  );

  const closeRail = useCallback(() => {
    setSearchParams((prev) => updateRailParam(prev, undefined));
  }, [setSearchParams]);

  // Shared panel width across both rail panels and tabs (matches Inspect).
  const [railPanelWidth, setRailPanelWidth] = useProperty<number>(
    "transcriptRail",
    "panelWidth",
    { defaultValue: 360 }
  );

  // Display mode for raw/rendered text
  const displayMode = useStore(
    (state) => state.transcriptState.displayMode ?? "rendered"
  );

  const toggleDisplayMode = useCallback(() => {
    setTranscriptState((prev) => ({
      ...prev,
      displayMode: prev.displayMode === "raw" ? "rendered" : "raw",
    }));
  }, [setTranscriptState]);

  const displayModeContextValue = useMemo(
    () => ({ displayMode }),
    [displayMode]
  );

  const railItems = useMemo<ActivityRailItem<RailPanelId>[]>(
    () => [
      {
        id: "search",
        label: "Search",
        icon: ApplicationIcons.search,
        disabled: !resolvedTranscriptsDir,
        title: resolvedTranscriptsDir
          ? "Search"
          : "Search unavailable for this transcript",
      },
      {
        id: "validation",
        label: "Validation",
        icon: ApplicationIcons.edit,
      },
    ],
    [resolvedTranscriptsDir]
  );

  const railNode = useMemo(
    () => (
      <ActivityRail
        items={railItems}
        active={activeRail}
        onSelect={onRailSelect}
      />
    ),
    [railItems, activeRail, onRailSelect]
  );

  const buildRailPanel = useCallback(
    (scope: "messages" | "events"): ReactNode => {
      if (activeRail === "search") {
        if (!resolvedTranscriptsDir) return null;
        return (
          <SearchPanel
            scope={scope}
            transcriptDir={resolvedTranscriptsDir}
            transcriptId={transcript.transcript_id}
            onClose={closeRail}
          />
        );
      }
      if (activeRail === "validation") {
        return (
          <ValidationCaseEditor
            transcriptId={transcript.transcript_id}
            taskId={transcript.task_id}
            taskRepeat={transcript.task_repeat}
            onClose={closeRail}
          />
        );
      }
      return null;
    },
    [activeRail, resolvedTranscriptsDir, transcript, closeRail]
  );

  const railLabel = activeRail === "validation" ? "Validation" : "Search";

  const tabTools: ReactNode[] = [];

  if (resolvedSelectedTranscriptTab === kTranscriptEventsTabId) {
    const label = isDebugFilter
      ? "Debug"
      : isDefaultFilter
        ? "Default"
        : "Custom";

    tabTools.push(
      <ToolButton
        key="events-filter-transcript"
        label={`Events: ${label}`}
        icon={ApplicationIcons.filter}
        onClick={toggleTranscriptFilterShowing}
        className={styles.tabTool}
        subtle={true}
        ref={transcriptFilterButtonRef}
      />
    );

    tabTools.push(
      <ToolButton
        key="event-collapse-transcript"
        label={eventsCollapsed ? "Expand" : "Collapse"}
        icon={
          eventsCollapsed
            ? ApplicationIcons.expand.all
            : ApplicationIcons.collapse.all
        }
        onClick={() => {
          collapseEvents(!eventsCollapsed);
        }}
        subtle={true}
      />
    );
  }

  tabTools.push(
    <ToolButton
      key="display-mode-toggle"
      label={displayMode === "rendered" ? "Raw" : "Rendered"}
      icon={ApplicationIcons.display}
      onClick={toggleDisplayMode}
      className={styles.tabTool}
      subtle={true}
      title={
        displayMode === "rendered"
          ? "Show raw text without markdown rendering"
          : "Show rendered markdown"
      }
    />
  );

  tabTools.push(
    <CopyToolbarButton
      key="copy-toolbar-button"
      transcript={transcript}
      className={styles.tabTool}
    />
  );

  // Rail panels are sticky below the tab bar.
  const contentOffsetTop = tabBarHeight;

  const messagesPanel = (
    <TabPanel
      key={kTranscriptMessagesTabId}
      id={kTranscriptMessagesTabId}
      title="Messages"
      onSelected={() => {
        handleTabChange(kTranscriptMessagesTabId);
      }}
      selected={resolvedSelectedTranscriptTab === kTranscriptMessagesTabId}
      scrollable={false}
    >
      <div className={styles.railHost}>
        <div className={styles.railContent}>
          <div className={styles.chatList}>
            <ChatViewVirtualList
              id={`transcript-${visitId}`}
              messages={transcript.messages || []}
              initialMessageId={messageParam}
              scrollRef={scrollRef}
              display={{
                formatDateTime,
              }}
              labels={messagesReferenceLabels}
              linking={{
                enabled: isHostedEnvironment(),
                getMessageUrl: getFullMessageUrl,
              }}
            />
          </div>
        </div>
        <RailDock
          rail={railNode}
          panel={buildRailPanel("messages")}
          scrollRef={scrollRef}
          offsetTop={contentOffsetTop}
          panelWidth={railPanelWidth}
          onPanelWidthChange={setRailPanelWidth}
          label={railLabel}
        />
      </div>
    </TabPanel>
  );

  const eventsRightRail = useMemo<TranscriptLayoutRightRailProps>(
    () => ({
      rail: railNode,
      panel: buildRailPanel("events"),
      label: railLabel,
      panelWidth: railPanelWidth,
      onPanelWidthChange: setRailPanelWidth,
    }),
    [railNode, buildRailPanel, railLabel, railPanelWidth, setRailPanelWidth]
  );

  const eventsPanel = hasEvents ? (
    <TabPanel
      key="transcript-events"
      id={kTranscriptEventsTabId}
      className={clsx(styles.eventsTab)}
      title="Events"
      onSelected={() => {
        handleTabChange(kTranscriptEventsTabId);
      }}
      selected={resolvedSelectedTranscriptTab === kTranscriptEventsTabId}
      scrollable={false}
    >
      <TimelineEventsView
        events={filteredEvents}
        scrollRef={scrollRef}
        offsetTop={contentOffsetTop}
        initialEventId={eventParam}
        initialMessageId={messageParam}
        defaultOutlineExpanded={true}
        id={`transcript-events-list-${visitId}`}
        bulkCollapse={
          eventsCollapsed === undefined
            ? undefined
            : eventsCollapsed
              ? "collapse"
              : "expand"
        }
        onMarkerNavigate={handleMarkerNavigate}
        timelines={transcript.timelines}
        headroomHidden={headroomHidden}
        onHeadroomResetAnchor={onHeadroomResetAnchor}
        onHeadroomSetHidden={onHeadroomSetHidden}
        getEventUrl={getFullEventUrl}
        getEventFocusUrl={getEventFocusUrl}
        onOpenEventFocus={onOpenEventFocus}
        onNavigatedToEvent={onNavigatedToEvent}
        linkingEnabled={isHostedEnvironment()}
        messageLabels={eventsReferenceLabels?.messageLabels}
        eventLabels={eventsReferenceLabels?.eventLabels}
        rightRail={eventsRightRail}
      />
      <TranscriptFilterPopover
        showing={transcriptFilterShowing}
        setShowing={setTranscriptFilterShowing}
        // eslint-disable-next-line react-hooks/refs -- positionEl accepts null; PopOver/Popper handles this in effects and updates when ref is populated
        positionEl={transcriptFilterButtonRef.current}
      />
    </TabPanel>
  ) : null;

  // Events tab first when available, then Messages
  const tabPanels = [...(eventsPanel ? [eventsPanel] : []), messagesPanel];

  if (transcript.metadata && Object.keys(transcript.metadata).length > 0) {
    tabPanels.push(
      <TabPanel
        key="transcript-metadata"
        id={kTranscriptMetadataTabId}
        className={clsx(styles.metadataTab)}
        title="Metadata"
        onSelected={() => {
          handleTabChange(kTranscriptMetadataTabId);
        }}
        selected={resolvedSelectedTranscriptTab === kTranscriptMetadataTabId}
        scrollable={false}
      >
        <div className={styles.scrollable}>
          <MetaDataGrid
            id="transcript-metadata-grid"
            entries={transcript.metadata || {}}
            className={clsx(styles.metadata)}
            options={{ striped: true, copyButton: true }}
          />
        </div>
      </TabPanel>
    );
  }

  const { events, messages, metadata, ...infoData } = transcript;
  tabPanels.push(
    <TabPanel
      key="transcript-info"
      id={kTranscriptInfoTabId}
      className={clsx(styles.infoTab)}
      title="Info"
      onSelected={() => {
        handleTabChange(kTranscriptInfoTabId);
      }}
      selected={resolvedSelectedTranscriptTab === kTranscriptInfoTabId}
      scrollable={false}
    >
      <div className={styles.scrollable}>
        <MetaDataGrid
          id="transcript-info-grid"
          entries={infoData}
          className={clsx(styles.metadata)}
          options={{ striped: true, copyButton: true }}
        />
      </div>
    </TabPanel>
  );

  const tabSet = (
    <TabSet
      id={"transcript-body"}
      type="pills"
      tabsRef={tabsRef}
      tabPanelsClassName={clsx(styles.tabSet)}
      tabControlsClassName={clsx(styles.tabControl)}
      className={clsx(styles.tabs)}
      tools={tabTools}
    >
      {tabPanels}
    </TabSet>
  );

  return (
    <DisplayModeContext.Provider value={displayModeContextValue}>
      {tabSet}
    </DisplayModeContext.Provider>
  );
};

const CopyToolbarButton: FC<{
  transcript: Transcript;
  className?: string | string[];
}> = ({ transcript, className }) => {
  const [icon, setIcon] = useState<string>(ApplicationIcons.copy);

  const showCopyConfirmation = useCallback(() => {
    setIcon(ApplicationIcons.confirm);
    setTimeout(() => setIcon(ApplicationIcons.copy), 1250);
  }, []);

  if (!transcript) {
    return undefined;
  }

  return (
    <ToolDropdownButton
      key="sample-copy"
      label="Copy"
      icon={icon}
      className={clsx(className)}
      dropdownClassName={"text-size-smallest"}
      dropdownAlign="right"
      subtle={true}
      items={{
        UUID: () => {
          if (transcript.transcript_id) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            navigator.clipboard.writeText(transcript.transcript_id);
            showCopyConfirmation();
          }
        },
        Transcript: () => {
          if (transcript.messages) {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            navigator.clipboard.writeText(messagesToStr(transcript.messages));
            showCopyConfirmation();
          }
        },
      }}
    />
  );
};
