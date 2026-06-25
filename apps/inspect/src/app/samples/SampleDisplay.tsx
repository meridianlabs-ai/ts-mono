import clsx from "clsx";
import {
  CSSProperties,
  FC,
  Fragment,
  MouseEvent,
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

import { EvalSample, EvalSpec } from "@tsmono/inspect-common/types";
import {
  ChatViewVirtualList,
  messagesToStr,
} from "@tsmono/inspect-components/chat";
import {
  DisplayModeContext,
  RecordTree,
} from "@tsmono/inspect-components/content";
import {
  eventsToStr,
  type TranscriptLayoutRightRailProps,
} from "@tsmono/inspect-components/transcript";
import type { SearchScope } from "@tsmono/inspect-components/transcript-search";
import {
  buildArgsByModel,
  buildArgsByRole,
  buildConfigsByModel,
  buildConfigsByRole,
  fmtClock,
  fmtCompactDuration,
  MetaItem,
  UsagePanel,
} from "@tsmono/inspect-components/usage";
import {
  ActivityRail,
  ANSIDisplay,
  Card,
  CardBody,
  CardHeader,
  NoContentsPanel,
  RailDock,
  StickyScroll,
  TabPanel,
  TabSet,
  ToolButton,
  ToolDropdownButton,
  type ActivityRailItem,
} from "@tsmono/react/components";
import { useElementHeight, useScrollDirection } from "@tsmono/react/hooks";
import { isHostedEnvironment, isVscode } from "@tsmono/util";

import { Events } from "../../@types/extraInspect";
import { SampleSummary } from "../../client/api/types";
import { ActivityBar } from "../../components/ActivityBar";
import {
  kSampleErrorTabId,
  kSampleJsonTabId,
  kSampleMessagesTabId,
  kSampleMetdataTabId,
  kSampleRetriesTabId,
  kSampleScoringTabId,
  kSampleTranscriptTabId,
  kSampleUsageTabId,
} from "../../constants";
import {
  useDocumentTitle,
  useSampleData,
  useSelectedSampleSummary,
} from "../../state/hooks";
import { useApi, useStore } from "../../state/store";
import { formatDateTime } from "../../utils/format";
import { ApplicationIcons } from "../appearance/icons";
import { useSampleDetailNavigation } from "../routing/sampleNavigation";
import {
  printSampleUrl,
  sampleMessageUrl,
  useLogOrSampleRouteParams,
  useRoutePrefix,
  useSampleUrlBuilder,
} from "../routing/url";
import { openInNewTab } from "../shared/openInNewTab";

import {
  messagesFromEvents,
  type MessagesFromEventsState,
} from "./messagesFromEvents";
import styles from "./SampleDisplay.module.css";
import { SampleJSONView } from "./SampleJSONView";
import { SampleRetriedErrors } from "./SampleRetriedErrors";
import { SampleSummaryView } from "./SampleSummaryView";
import { ScansSidebarPanel } from "./scans/ScansSidebarPanel";
import { useSampleScans } from "./scans/useSampleScans";
import { SampleScoresView } from "./scores/SampleScoresView";
import { useTranscriptFilter } from "./transcript/hooks";
import { useInspectSearchContext } from "./transcript/search/inspectSearchAdapters";
import { mergeTranscriptLabelContext } from "./transcript/search/mergeTranscriptLabelContext";
import { SearchPanelSlot } from "./transcript/search/SearchPanelSlot";
import { useInspectSearchReferenceLabels } from "./transcript/search/useInspectSearchReferenceLabels";
import { TranscriptFilterPopover } from "./transcript/TranscriptFilter";
import { TranscriptPanel } from "./transcript/TranscriptPanel";

interface SampleDisplayProps {
  id: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  showActivity: boolean;
  progress?: number;
  focusOnLoad?: boolean;
}

type ActivityRailItemId = "search" | "scans";

/**
 * Component to display a sample with relevant context and visibility control.
 */
export const SampleDisplay: FC<SampleDisplayProps> = ({
  id,
  scrollRef,
  showActivity,
  progress,
  focusOnLoad,
}) => {
  // Tab ids
  const baseId = `sample-display`;

  const prefix = useRoutePrefix();
  const sampleData = useSampleData();
  const sample = useMemo(() => {
    return sampleData.getSelectedSample();
  }, [sampleData]);
  const eventsCleared = sampleData.eventsCleared;

  const runningSampleData = sampleData.running;

  const evalSpec = useStore((state) => state.log.selectedLogDetails?.eval);
  const { setDocumentTitle } = useDocumentTitle();
  useEffect(() => {
    setDocumentTitle({ evalSpec, sample });
  }, [setDocumentTitle, sample, evalSpec]);

  // Selected tab handling
  const selectedTab = useStore((state) => state.app.tabs.sample);
  const setSelectedTab = useStore((state) => state.appActions.setSampleTab);

  // Per-tab scroll positions persist while tabbing within a sample (each tab's
  // VirtualList snapshot is keyed by sample id). Clear them when leaving this
  // sample so re-entering starts at the top rather than a stale offset.
  const removeBagsByPrefix = useStore(
    (state) => state.appActions.removeBagsByPrefix
  );
  useEffect(() => {
    // Prefixes cover the dynamic suffixes on these bag names (the transcript's
    // `:<timeline>` selection, branch ids, etc.).
    const snapshotBagPrefixes = [
      `chat-${baseId}-chat-${id}`,
      `${baseId}-transcript-display-${id}`,
    ];
    return () => {
      for (const prefix of snapshotBagPrefixes) {
        removeBagsByPrefix(prefix);
      }
    };
  }, [baseId, id, removeBagsByPrefix]);

  // Navigation hook for URL updates
  const navigate = useNavigate();

  const tabsRef: RefObject<HTMLUListElement | null> = useRef(null);
  const tabsHeight = useElementHeight(tabsRef);

  const selectedSampleSummary = useSelectedSampleSummary();

  // Consolidate the events and messages into the proper list
  // whether running or not
  const sampleEvents = sample?.events || runningSampleData;
  // Cache messagesFromEvents work across polls. The polling pipeline
  // only ever appends to the running events array (or replaces a tail
  // event during streaming updates), so a pure-extension call only
  // processes the new tail. Diverging events trigger a rebuild.
  const messagesRef = useRef<MessagesFromEventsState | null>(null);
  const sampleMessages = useMemo(() => {
    /* eslint-disable react-hooks/refs */
    if (sample?.messages) {
      messagesRef.current = null;
      return sample.messages;
    } else if (runningSampleData) {
      return messagesFromEvents(runningSampleData, messagesRef);
    } else {
      messagesRef.current = null;
      return [];
    }
    /* eslint-enable react-hooks/refs */
  }, [sample?.messages, runningSampleData]);

  // Get all URL parameters at component level
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
    sampleTabId,
  } = useLogOrSampleRouteParams();

  // Reset tab to default when this sample view unmounts
  const clearSampleTab = useStore((state) => state.appActions.clearSampleTab);
  useEffect(() => {
    return () => {
      clearSampleTab();
    };
  }, [clearSampleTab]);

  // Use sampleTabId from parsed route if available, otherwise use the one from state
  const effectiveSelectedTab = sampleTabId || selectedTab;

  // Focus the panel when it loads
  useEffect(() => {
    setTimeout(() => {
      if (focusOnLoad) {
        scrollRef.current?.focus();
      }
    }, 10);
  }, [focusOnLoad, scrollRef]);

  // Tab selection
  const sampleUrlBuilder = useSampleUrlBuilder();
  const onSelectedTab = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const id = el.id;
      setSelectedTab(id);

      // Use navigation hook to update URL with tab
      if (id !== sampleTabId && urlLogPath) {
        const url = sampleUrlBuilder(urlLogPath, urlSampleId, urlEpoch, id);
        void navigate(url);
      }
    },
    [
      setSelectedTab,
      sampleTabId,
      urlLogPath,
      sampleUrlBuilder,
      urlSampleId,
      urlEpoch,
      navigate,
    ]
  );

  const setNativeFind = useStore((state) => state.appActions.setNativeFind);

  const getMessageUrl = useCallback(
    (messageId: string) => {
      return urlLogPath
        ? sampleMessageUrl(
            sampleUrlBuilder,
            messageId,
            urlLogPath,
            urlSampleId,
            urlEpoch
          )
        : undefined;
    },
    [sampleUrlBuilder, urlLogPath, urlSampleId, urlEpoch]
  );

  // Stable option objects so memoized ChatMessageRow rows don't re-render on
  // every streaming poll just because these were fresh literals each render.
  const chatDisplay = useMemo(() => ({ indented: true, formatDateTime }), []);
  const chatLinking = useMemo(
    () => ({ enabled: isHostedEnvironment(), getMessageUrl }),
    [getMessageUrl]
  );
  const chatTools = useMemo(() => ({ callStyle: "complete" as const }), []);

  const sampleUsages = usageViewsForSample(`${baseId}-${id}`, sample, evalSpec);
  const sampleMetadatas = metadataViewsForSample(
    `${baseId}-${id}`,
    // The helper only forwards scrollRef into JSX props (RecordTree
    // scrollRef={...}); it never reads .current during render.
    // eslint-disable-next-line react-hooks/refs
    scrollRef,
    sample
  );

  const tabsetId = `task-sample-details-tab-${id}`;

  const isShowing = useStore((state) => state.app.dialogs.transcriptFilter);
  const setShowing = useStore(
    (state) => state.appActions.setShowingTranscriptFilterDialog
  );

  const displayMode = useStore((state) => state.app.displayMode);
  const setDisplayMode = useStore((state) => state.appActions.setDisplayMode);

  const [filterButtonEl, setFilterButtonEl] =
    useState<HTMLButtonElement | null>(null);
  const optionsRef = useRef<HTMLButtonElement | null>(null);

  // Fall back to store state for single-file mode where URL doesn't contain sample ID/epoch
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );
  const printLogPath = urlLogPath || selectedLogFile;
  const printSampleId = urlSampleId || selectedSampleHandle?.id?.toString();
  const printEpoch = urlEpoch || selectedSampleHandle?.epoch?.toString();

  const handlePrintClick = useCallback(() => {
    if (printLogPath && printSampleId && printEpoch) {
      const printUrl = printSampleUrl(
        printLogPath,
        printSampleId,
        printEpoch,
        effectiveSelectedTab,
        prefix
      );
      openInNewTab(printUrl);
    }
  }, [printLogPath, printSampleId, printEpoch, effectiveSelectedTab, prefix]);

  // Intercept Cmd+P / Ctrl+P to use custom print route
  useEffect(() => {
    if (isVscode() || !printLogPath || !printSampleId || !printEpoch) return;

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        e.stopPropagation();
        handlePrintClick();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handlePrintClick, printLogPath, printSampleId, printEpoch]);

  const toggleFilter = useCallback(() => {
    setShowing(!isShowing);
  }, [setShowing, isShowing]);

  const toggleDisplayMode = useCallback(() => {
    setDisplayMode(displayMode === "rendered" ? "raw" : "rendered");
  }, [displayMode, setDisplayMode]);

  const collapsedMode = useStore((state) => state.sample.collapsedMode);
  const setCollapsedMode = useStore(
    (state) => state.sampleActions.setCollapsedMode
  );

  const isCollapsed = (mode: "collapsed" | "expanded" | null) => {
    return mode === "collapsed"; //null is expanded
  };

  const toggleCollapsedMode = useCallback(() => {
    setCollapsedMode(isCollapsed(collapsedMode) ? "expanded" : "collapsed");
  }, [collapsedMode, setCollapsedMode]);

  const { isDebugFilter, isDefaultFilter, isNoneFilter } =
    useTranscriptFilter();

  const api = useApi();
  const downloadFiles = useStore((state) => state.capabilities.downloadFiles);

  const [icon, setIcon] = useState(ApplicationIcons.copy);

  // Right-docked sidebar — search and scans share a single slot (one at a
  // time), each toggled from the toolbar. Scope follows the active tab. The
  // choice is persisted per log so a closed dock stays closed across reloads.
  const setPropertyValue = useStore(
    (state) => state.appActions.setPropertyValue
  );
  const dockKey = urlLogPath || "na";
  const storedDock = useStore((state) => {
    const value = state.app.propertyBags["rail-dock"]?.[dockKey];
    return value === "none" || value === "search" || value === "scans"
      ? value
      : undefined;
  });
  const rightDock = storedDock ?? "none";
  const setRightDock = useCallback(
    (value: "none" | "search" | "scans") =>
      setPropertyValue("rail-dock", dockKey, value),
    [setPropertyValue, dockKey]
  );
  const searchScope: SearchScope | undefined =
    effectiveSelectedTab === kSampleTranscriptTabId
      ? "events"
      : effectiveSelectedTab === kSampleMessagesTabId
        ? "messages"
        : undefined;
  const searchContext = useInspectSearchContext(sample);
  const canSearch = searchContext !== null && searchScope !== undefined;
  const closeDock = useCallback(() => setRightDock("none"), [setRightDock]);
  // Rail entries toggle their panel: re-selecting the active one closes it,
  // selecting another switches directly (panels are mutually exclusive).
  const onRailSelect = useCallback(
    (id: ActivityRailItemId) => setRightDock(rightDock === id ? "none" : id),
    [rightDock, setRightDock]
  );
  const railPanelScrollRef = useRef<HTMLDivElement | null>(null);

  // Panel width is a global preference persisted across samples and reloads,
  // shared by the Transcript and Messages tabs.
  const railPanelWidth = useStore((state) => {
    const value = state.app.propertyBags["sidebar-widths"]?.["rail-panel"];
    return typeof value === "number" ? value : undefined;
  });
  const setRailPanelWidth = useCallback(
    (value: number) => setPropertyValue("sidebar-widths", "rail-panel", value),
    [setPropertyValue]
  );

  // Scanner scores power the docked Scans panel (and the transcript cite
  // labels). `open` gates the label computation to when the panel is showing.
  const scans = useSampleScans({
    allScores: sample?.scores ?? null,
    sampleId: sample?.id ?? undefined,
    sampleEpoch: sample?.epoch ?? undefined,
    open: rightDock === "scans",
  });

  // Search cites label the transcript the same way scanner cites do; the
  // hook follows the active tab's scope and yields nothing until a search
  // runs. Rail panels are mutually exclusive, so in practice only one of
  // scan/search labels is present at a time, but the merge is defensive.
  const searchReferenceLabels = useInspectSearchReferenceLabels({
    scope: searchScope ?? "events",
    context: searchContext,
  });
  const transcriptSearchLabels =
    searchScope === "events" ? searchReferenceLabels : undefined;
  const messagesSearchLabels =
    searchScope === "messages" ? searchReferenceLabels : undefined;
  const transcriptEventNodeContext = useMemo(
    () =>
      mergeTranscriptLabelContext(
        scans.eventNodeContext,
        transcriptSearchLabels
      ),
    [scans.eventNodeContext, transcriptSearchLabels]
  );

  // Open the Scans panel by default the first time a sample with scans loads
  // *for a given log*, unless that log already has a persisted dock choice
  // (including "none" — a user who closed the dock shouldn't have it forced
  // back open). Keyed by dockKey because SampleDisplay stays mounted while the
  // cross-log Samples browser navigates between logs.
  const scansDefaultedForKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (scans.hasScans && scansDefaultedForKeyRef.current !== dockKey) {
      scansDefaultedForKeyRef.current = dockKey;
      if (storedDock === undefined) {
        setRightDock("scans");
      }
    }
  }, [scans.hasScans, storedDock, setRightDock, dockKey]);

  // Build the toolbar in left-to-right groups separated by thin dividers:
  //   [tab-specific view controls] | [shared sample actions] | [Search]
  const tools: ReactNode[] = [];

  if (effectiveSelectedTab === kSampleTranscriptTabId) {
    const label = isNoneFilter
      ? "None"
      : isDebugFilter
        ? "Debug"
        : isDefaultFilter
          ? "Default"
          : "Custom";

    tools.push(
      <ToolButton
        key="sample-filter-transcript"
        label={`Events: ${label}`}
        icon={ApplicationIcons.filter}
        onClick={toggleFilter}
        ref={setFilterButtonEl}
        subtle
      />,
      <ToolButton
        key="sample-collapse-transcript"
        label={isCollapsed(collapsedMode) ? "Expand" : "Collapse"}
        icon={
          isCollapsed(collapsedMode)
            ? ApplicationIcons.expand.all
            : ApplicationIcons.collapse.all
        }
        onClick={toggleCollapsedMode}
        subtle
      />
    );
  }

  tools.push(
    <ToolButton
      key="options-button"
      label={"Raw"}
      icon={ApplicationIcons.display}
      onClick={toggleDisplayMode}
      ref={optionsRef}
      latched={displayMode === "raw"}
      subtle
    />
  );

  tools.push(
    <span
      key="actions-separator"
      className={styles.toolSeparator}
      aria-hidden="true"
    />,
    <ToolDropdownButton
      key="sample-copy"
      label="Copy"
      icon={icon}
      subtle
      dropdownClassName="text-size-smallest"
      items={{
        UUID: () => {
          if (sample?.uuid) {
            void navigator.clipboard.writeText(sample.uuid);
            setIcon(ApplicationIcons.confirm);
            setTimeout(() => {
              setIcon(ApplicationIcons.copy);
            }, 1250);
          }
        },
        Messages: () => {
          if (sample?.messages) {
            void navigator.clipboard.writeText(messagesToStr(sample.messages));
            setIcon(ApplicationIcons.confirm);
            setTimeout(() => {
              setIcon(ApplicationIcons.copy);
            }, 1250);
          }
        },
        Transcript: () => {
          if (sampleEvents && sampleEvents.length > 0) {
            void navigator.clipboard.writeText(eventsToStr(sampleEvents));
            setIcon(ApplicationIcons.confirm);
            setTimeout(() => {
              setIcon(ApplicationIcons.copy);
            }, 1250);
          }
        },
      }}
    />
  );

  if (downloadFiles && sample && api.download_file) {
    const sampleId = sample.id ?? "sample";
    tools.push(
      <ToolDropdownButton
        key="sample-download"
        label="Download"
        icon={ApplicationIcons.downloadLog}
        subtle
        dropdownClassName="text-size-smallest"
        items={{
          "Sample JSON": () => {
            void api.download_file(
              `${sampleId}.json`,
              JSON.stringify(sample, null, 2)
            );
          },
          Messages: () => {
            if (sample.messages && sample.messages.length > 0) {
              void api.download_file(
                `${sampleId}-messages.txt`,
                messagesToStr(sample.messages)
              );
            }
          },
          Transcript: () => {
            if (sampleEvents && sampleEvents.length > 0) {
              void api.download_file(
                `${sampleId}-transcript.txt`,
                eventsToStr(sampleEvents)
              );
            }
          },
        }}
      />
    );
  }

  if (!isVscode() && printLogPath && printSampleId && printEpoch) {
    tools.push(
      <ToolButton
        key="sample-print-tool"
        label="Print"
        icon={ApplicationIcons.copy}
        onClick={handlePrintClick}
        subtle
      />
    );
  }

  // Search and Scans are no longer toolbar buttons — the always-visible
  // activity rail (rendered below the timeline) is the sole entry point.

  // Is the sample running?
  const running = useMemo(() => {
    return isRunning(
      selectedSampleSummary,
      runningSampleData,
      sampleData.status
    );
  }, [selectedSampleSummary, runningSampleData, sampleData.status]);

  const sampleDetailNavigation = useSampleDetailNavigation();

  const displayModeContext = useMemo(
    () => ({ displayMode: displayMode ?? ("rendered" as const) }),
    [displayMode]
  );

  // Headroom-style collapse: the sample header is wrapped in a
  // `StickyScroll`, so the *same* SampleSummaryView renders both in
  // flow at the top and pinned at the top while scrolled. The
  // component's `collapsed` prop drives compact (meta-line-only) vs
  // full mode and is true only while sticky AND scrolling down past
  // the headroom threshold. When the user scrolls back up, the full
  // header expands while still sticky; when they reach the very top
  // the StickyScroll transitions to in-flow without re-rendering, so
  // the user never sees the header re-animate or "re-appear".
  const { hidden: headroomHidden } = useScrollDirection(scrollRef, {
    threshold: 80,
    stayHiddenOnUpScroll: true,
  });
  const [isHeaderSticky, setIsHeaderSticky] = useState(false);
  const handleHeaderStickyChange = useCallback((sticky: boolean) => {
    setIsHeaderSticky(sticky);
  }, []);
  const headerCollapsed = isHeaderSticky && headroomHidden;

  const headerWrapperRef = useRef<HTMLDivElement | null>(null);
  const headerHeight = useElementHeight(
    headerWrapperRef,
    !!selectedSampleSummary
  );

  // useElementHeight stops measuring while disabled, so zero out the stale
  // last-measured height here when there's no summary mounted.
  const effectiveHeaderHeight = selectedSampleSummary ? headerHeight : 0;
  const stickyOffsetTop = tabsHeight + effectiveHeaderHeight;

  const tabsContainerStyle = useMemo(
    () =>
      ({
        "--inspect-sample-header-height": `${effectiveHeaderHeight}px`,
      }) as CSSProperties,
    [effectiveHeaderHeight]
  );

  // Which rail entry (if any) is showing its panel. Scans only applies on the
  // Transcript tab and only when the sample actually has scans.
  const activeRailId: ActivityRailItemId | null =
    rightDock === "scans" && scans.hasScans
      ? "scans"
      : rightDock === "search" && searchContext
        ? "search"
        : null;

  // Shared rail entries for both the Transcript and Messages tabs: Search on
  // top, Scans below (per design). Scans is omitted entirely when the sample
  // has none.
  const railItems = useMemo<ActivityRailItem<ActivityRailItemId>[]>(() => {
    const items: ActivityRailItem<ActivityRailItemId>[] = [];
    if (canSearch) {
      items.push({
        id: "search",
        label: "Search",
        icon: ApplicationIcons.search,
      });
    }
    if (scans.hasScans) {
      items.push({
        id: "scans",
        label: "Scans",
        icon: ApplicationIcons.scoringSidebar,
      });
    }
    return items;
  }, [canSearch, scans.hasScans]);

  // When there are no rail entries (no search capability and no scans), the
  // rail host is omitted entirely so the right gutter doesn't render blank.
  const hasRail = railItems.length > 0;

  // Rail + panel nodes shared verbatim by the Transcript and Messages tabs;
  // the search scope follows the active tab.
  const railNode = useMemo(
    () => (
      <ActivityRail
        items={railItems}
        active={activeRailId}
        onSelect={onRailSelect}
      />
    ),
    [railItems, activeRailId, onRailSelect]
  );
  const railPanel = useMemo(
    () =>
      activeRailId === "scans" ? (
        <ScansSidebarPanel
          scores={scans.scores}
          events={sampleEvents}
          makeCiteUrl={scans.makeCiteUrl}
          selected={scans.selected}
          onSelectedChange={scans.setSelected}
          onClose={closeDock}
        />
      ) : activeRailId === "search" && searchContext && searchScope ? (
        <SearchPanelSlot
          scope={searchScope}
          context={searchContext}
          onClose={closeDock}
        />
      ) : null,
    [
      activeRailId,
      scans.scores,
      scans.makeCiteUrl,
      scans.selected,
      scans.setSelected,
      sampleEvents,
      searchContext,
      searchScope,
      closeDock,
    ]
  );
  const railLabel = activeRailId === "scans" ? "Scans" : "Search";

  const transcriptRail = useMemo<TranscriptLayoutRightRailProps>(
    () => ({
      rail: railNode,
      panel: railPanel,
      label: railLabel,
      panelWidth: railPanelWidth,
      onPanelWidthChange: setRailPanelWidth,
    }),
    [railNode, railPanel, railLabel, railPanelWidth, setRailPanelWidth]
  );

  return (
    <DisplayModeContext.Provider value={displayModeContext}>
      <Fragment>
        {selectedSampleSummary ? (
          <StickyScroll
            scrollRef={scrollRef}
            offsetTop={0}
            zIndex={1002}
            onStickyChange={handleHeaderStickyChange}
          >
            <div ref={headerWrapperRef}>
              <SampleSummaryView
                parent_id={id}
                sample={selectedSampleSummary}
                collapsed={headerCollapsed}
              />
            </div>
          </StickyScroll>
        ) : undefined}
        <ActivityBar animating={showActivity} progress={progress} />

        <div style={tabsContainerStyle}>
          <TabSet
            id={tabsetId}
            tabsRef={tabsRef}
            className={clsx(styles.tabControls)}
            tabControlsClassName={clsx("text-size-base")}
            tools={tools}
            type="pills-small"
          >
            <TabPanel
              key={kSampleTranscriptTabId}
              id={kSampleTranscriptTabId}
              className={clsx(
                "sample-tab",
                styles.transcriptContainer,
                styles.overflowVisible
              )}
              title="Transcript"
              onSelected={onSelectedTab}
              selected={
                effectiveSelectedTab === kSampleTranscriptTabId ||
                effectiveSelectedTab === undefined
              }
              scrollable={false}
            >
              <TranscriptFilterPopover
                showing={isShowing}
                setShowing={setShowing}
                positionEl={filterButtonEl}
              />

              {!sampleEvents || sampleEvents.length === 0 ? (
                sampleData.status === "loading" ? null : (
                  <NoContentsPanel
                    text={
                      eventsCleared
                        ? "Transcript events were removed because this sample exceeds the browser's size limit. Use the Messages tab to view the conversation."
                        : "No events to display."
                    }
                  />
                )
              ) : (
                <div className={styles.tabContent}>
                  <TranscriptPanel
                    id={`${baseId}-transcript-display-${id}`}
                    key={`${baseId}-transcript-display-${id}`}
                    scrollRef={scrollRef}
                    offsetTop={stickyOffsetTop}
                    running={running}
                    events={sampleEvents}
                    timelines={sample?.timelines ?? undefined}
                    eventNodeContext={transcriptEventNodeContext}
                    initialEventId={sampleDetailNavigation.event}
                    initialMessageId={sampleDetailNavigation.message}
                    rightRail={hasRail ? transcriptRail : undefined}
                    rightRailPanelScrollRef={railPanelScrollRef}
                  />
                </div>
              )}
            </TabPanel>
            <TabPanel
              key={kSampleMessagesTabId}
              id={kSampleMessagesTabId}
              className={clsx(
                "sample-tab",
                styles.fullWidth,
                styles.overflowVisible
              )}
              title="Messages"
              onSelected={onSelectedTab}
              selected={effectiveSelectedTab === kSampleMessagesTabId}
              scrollable={false}
            >
              <RailSidebarHost
                contentClassName={styles.chat}
                scrollRef={scrollRef}
                panelTop={stickyOffsetTop}
                panelWidth={railPanelWidth}
                onPanelWidthChange={setRailPanelWidth}
                rail={hasRail ? railNode : undefined}
                panel={hasRail ? railPanel : undefined}
                label={railLabel}
              >
                <ChatViewVirtualList
                  key={`${baseId}-chat-${id}`}
                  id={`${baseId}-chat-${id}`}
                  messages={sampleMessages}
                  initialMessageId={sampleDetailNavigation.message}
                  offsetTop={stickyOffsetTop}
                  display={chatDisplay}
                  labels={messagesSearchLabels}
                  linking={chatLinking}
                  onNativeFindChanged={setNativeFind}
                  scrollRef={scrollRef}
                  tools={chatTools}
                  running={running}
                  className={styles.fullWidth}
                />
              </RailSidebarHost>
            </TabPanel>
            <TabPanel
              key={kSampleScoringTabId}
              id={kSampleScoringTabId}
              className="sample-tab"
              title="Scoring"
              onSelected={onSelectedTab}
              selected={effectiveSelectedTab === kSampleScoringTabId}
            >
              <SampleScoresView
                sample={sample}
                className={styles.padded}
                scrollRef={scrollRef}
              />
            </TabPanel>
            {sampleUsages.length > 0 ? (
              <TabPanel
                id={kSampleUsageTabId}
                className={clsx("sample-tab")}
                title="Usage"
                onSelected={onSelectedTab}
                selected={effectiveSelectedTab === kSampleUsageTabId}
              >
                <div
                  className={clsx(
                    styles.padded,
                    styles.fullWidth,
                    styles.metadataPanel
                  )}
                >
                  {sampleUsages}
                </div>
              </TabPanel>
            ) : null}
            <TabPanel
              id={kSampleMetdataTabId}
              className={clsx("sample-tab")}
              title="Metadata"
              onSelected={onSelectedTab}
              selected={effectiveSelectedTab === kSampleMetdataTabId}
            >
              {sampleMetadatas.length > 0 ? (
                <div
                  className={clsx(
                    styles.padded,
                    styles.fullWidth,
                    styles.metadataPanel
                  )}
                >
                  {sampleMetadatas}
                </div>
              ) : (
                <NoContentsPanel text="No sample metadata available" />
              )}
            </TabPanel>
            {sample?.error && (
              <TabPanel
                id={kSampleErrorTabId}
                className="sample-tab"
                title="Error"
                onSelected={onSelectedTab}
                selected={effectiveSelectedTab === kSampleErrorTabId}
              >
                <div className={clsx(styles.error)}>
                  {sample?.error ? (
                    <Card key={`sample-error}`}>
                      <CardHeader label={`Sample Error`} />
                      <CardBody>
                        <ANSIDisplay
                          output={sample.error.traceback_ansi}
                          className={clsx("text-size-small", styles.ansi)}
                          style={{
                            fontSize: "clamp(0.3rem, 1.1vw, 0.8rem)",
                            margin: "0.5em 0",
                          }}
                        />
                      </CardBody>
                    </Card>
                  ) : undefined}
                </div>
              </TabPanel>
            )}

            {sample?.error_retries && sample.error_retries.length > 0 ? (
              <TabPanel
                id={kSampleRetriesTabId}
                className="sample-tab"
                title="Retries"
                onSelected={onSelectedTab}
                selected={effectiveSelectedTab === kSampleRetriesTabId}
              >
                <div className={styles.retriedErrors}>
                  <SampleRetriedErrors
                    key={sample.uuid || String(sample.id)}
                    id={sample.uuid || String(sample.id)}
                    retries={sample.error_retries}
                    scrollRef={scrollRef}
                  />
                </div>
              </TabPanel>
            ) : null}

            <TabPanel
              id={kSampleJsonTabId}
              className={"sample-tab"}
              title="JSON"
              onSelected={onSelectedTab}
              selected={effectiveSelectedTab === kSampleJsonTabId}
            >
              {!sample ? (
                <NoContentsPanel text="JSON not available" />
              ) : (
                <div className={clsx(styles.padded, styles.fullWidth)}>
                  <SampleJSONView
                    sample={sample}
                    className={clsx("text-size-small")}
                  />
                </div>
              )}
            </TabPanel>
          </TabSet>
        </div>
      </Fragment>
    </DisplayModeContext.Provider>
  );
};

interface RailSidebarHostProps {
  /** The always-visible activity rail. Omit to render content with no rail. */
  rail?: ReactNode;
  /** The open panel, or null when no panel is active. */
  panel?: ReactNode;
  /** The outer scroll container the panel sticks within. */
  scrollRef: RefObject<HTMLDivElement | null>;
  panelTop: number;
  /** Controlled panel width, kept in sync with the Transcript tab's panel. */
  panelWidth?: number;
  onPanelWidthChange?: (width: number) => void;
  /** aria-label root for the panel region. */
  label?: string;
  /** Extra className applied to the main content slot. */
  contentClassName?: string;
  children: ReactNode;
}

/**
 * Flex host for tabs without a swimlane timeline (Messages): main content,
 * then the shared <RailDock> (optional resizable panel + always-visible rail)
 * pinned right. Mirrors the transcript tab's rail layout.
 */
const RailSidebarHost: FC<RailSidebarHostProps> = ({
  rail,
  panel,
  scrollRef,
  panelTop,
  panelWidth,
  onPanelWidthChange,
  label,
  contentClassName,
  children,
}) => (
  <div className={styles.railHost}>
    <div className={clsx(styles.tabContent, contentClassName)}>{children}</div>
    {rail != null && (
      <RailDock
        rail={rail}
        panel={panel}
        scrollRef={scrollRef}
        offsetTop={panelTop}
        panelWidth={panelWidth}
        onPanelWidthChange={onPanelWidthChange}
        label={label}
      />
    )}
  </div>
);

interface SampleUsagePanelProps {
  id: string;
  sample: EvalSample;
  evalSpec?: EvalSpec;
}

const SampleUsagePanel: FC<SampleUsagePanelProps> = ({
  id,
  sample,
  evalSpec,
}) => {
  const roleAliases = useMemo(() => {
    if (!evalSpec?.model_roles) return undefined;
    const roles: Record<string, string> = {};
    for (const [role, config] of Object.entries(evalSpec.model_roles)) {
      if (config.model) roles[role] = config.model;
    }
    return Object.keys(roles).length > 0 ? roles : undefined;
  }, [evalSpec]);

  const configsByModel = useMemo(
    () => buildConfigsByModel(evalSpec),
    [evalSpec]
  );
  const configsByRole = useMemo(() => buildConfigsByRole(evalSpec), [evalSpec]);
  const argsByModel = useMemo(() => buildArgsByModel(evalSpec), [evalSpec]);
  const argsByRole = useMemo(() => buildArgsByRole(evalSpec), [evalSpec]);

  const meta = useMemo<MetaItem[]>(() => {
    const items: MetaItem[] = [];
    if (sample.working_time != null) {
      items.push({
        label: "Working time",
        value: fmtCompactDuration(sample.working_time),
      });
    }
    if (sample.total_time != null) {
      items.push({
        label: "Total time",
        value: fmtCompactDuration(sample.total_time),
      });
    }
    if (sample.started_at || sample.completed_at) {
      const showDate = !!(
        sample.started_at &&
        sample.completed_at &&
        new Date(sample.started_at).toDateString() !==
          new Date(sample.completed_at).toDateString()
      );
      items.push({
        label: "Window",
        value: `${fmtClock(sample.started_at, showDate)} → ${fmtClock(sample.completed_at, showDate)}`,
      });
    }
    return items;
  }, [
    sample.working_time,
    sample.total_time,
    sample.started_at,
    sample.completed_at,
  ]);

  return (
    <UsagePanel
      key={`sample-usage-${id}`}
      model_usage={sample.model_usage ?? undefined}
      role_usage={sample.role_usage ?? undefined}
      configs_by_model={configsByModel}
      configs_by_role={configsByRole}
      args_by_model={argsByModel}
      args_by_role={argsByRole}
      role_aliases={roleAliases}
      meta={meta}
    />
  );
};

const usageViewsForSample = (
  id: string,
  sample?: EvalSample,
  evalSpec?: EvalSpec
) => {
  if (!sample) return [];
  const views = [];

  if (
    (sample.model_usage && Object.keys(sample.model_usage).length > 0) ||
    (sample.role_usage && Object.keys(sample.role_usage).length > 0)
  ) {
    views.push(
      <SampleUsagePanel
        key={`sample-usage-${id}`}
        id={id}
        sample={sample}
        evalSpec={evalSpec}
      />
    );
  }

  return views;
};

const metadataViewsForSample = (
  id: string,
  scrollRef: RefObject<HTMLDivElement | null>,
  sample?: EvalSample
) => {
  if (!sample) {
    return [];
  }
  const sampleMetadatas = [];

  // Show invalidation details prominently if sample is invalidated
  if (sample.invalidation) {
    const formatTimestamp = (timestamp: string) => {
      try {
        return formatDateTime(new Date(timestamp));
      } catch {
        return timestamp;
      }
    };

    const invalidationRecord: Record<string, unknown> = {};
    if (sample.invalidation.author) {
      invalidationRecord["Author"] = sample.invalidation.author;
    }
    if (sample.invalidation.timestamp) {
      invalidationRecord["Timestamp"] = formatTimestamp(
        sample.invalidation.timestamp
      );
    }
    if (sample.invalidation.reason) {
      invalidationRecord["Reason"] = sample.invalidation.reason;
    }
    if (
      sample.invalidation.metadata &&
      Object.keys(sample.invalidation.metadata).length > 0
    ) {
      invalidationRecord["Metadata"] = sample.invalidation.metadata;
    }

    sampleMetadatas.push(
      <Card key={`sample-invalidation-${id}`}>
        <CardHeader label="Invalidation" />
        <CardBody padded={false}>
          <RecordTree
            id={`task-sample-invalidation-${id}`}
            record={invalidationRecord}
            className={clsx("tab-pane", styles.noTop)}
            scrollRef={scrollRef}
            copyButton={true}
          />
        </CardBody>
      </Card>
    );
  }

  if (Object.keys(sample?.metadata).length > 0) {
    sampleMetadatas.push(
      <Card key={`sample-metadata-${id}`}>
        <CardHeader label="Metadata" />
        <CardBody padded={false}>
          <RecordTree
            id={`task-sample-metadata-${id}`}
            record={sample?.metadata}
            className={clsx("tab-pane", styles.noTop)}
            scrollRef={scrollRef}
            copyButton={true}
          />
        </CardBody>
      </Card>
    );
  }

  if (Object.keys(sample?.store).length > 0) {
    sampleMetadatas.push(
      <Card key={`sample-store-${id}`}>
        <CardHeader label="Store" />
        <CardBody padded={false}>
          <RecordTree
            id={`task-sample-store-${id}`}
            record={sample?.store}
            className={clsx("tab-pane", styles.noTop)}
            scrollRef={scrollRef}
            processStore={true}
            copyButton={true}
          />
        </CardBody>
      </Card>
    );
  }

  return sampleMetadatas;
};

const isRunning = (
  sampleSummary?: SampleSummary,
  runningSampleData?: Events,
  sampleStatus?: string
): boolean => {
  // If a completed sample has been loaded, it's not running
  if (sampleStatus === "ok") {
    return false;
  }

  if (sampleSummary && sampleSummary.completed === false) {
    // An explicitly incomplete sample summary
    return true;
  }

  if (
    !sampleSummary &&
    (!runningSampleData || runningSampleData.length === 0)
  ) {
    // No sample summary yet and no running samples, must've just started
    return true;
  }

  if (runningSampleData && runningSampleData.length > 0) {
    // There are running samples
    return true;
  }

  return false;
};
