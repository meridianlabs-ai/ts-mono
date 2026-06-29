import clsx from "clsx";
import {
  FC,
  isValidElement,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import { CopyButton, useStickyScroll } from "@tsmono/react/components";
import { useProperty } from "@tsmono/react/hooks";

import { MessageLabel } from "../../chat/MessageLabel";
import { EventLabelContext } from "../EventLabelContext";
import { FocusTabContext } from "../FocusTabContext";
import type { EventPanelCallbacks } from "../types";

import { EventNavs } from "./EventNavs";
import styles from "./EventPanel.module.css";

// Default Bootstrap icon classes (same in both apps)
const kChevronRight = "bi bi-chevron-right";
const kChevronDown = "bi bi-chevron-down";
const kLinkIcon = "bi bi-link-45deg";
const kDefaultIcon = "bi bi-table";

interface EventPanelProps {
  eventNodeId: string;
  className?: string;
  title?: string;
  subTitle?: string;
  text?: string;
  icon?: string;
  children?: ReactNode | ReactNode[];
  childIds?: string[];
  collapsibleContent?: boolean;
  collapseControl?: "top" | "bottom";
  /** Use the muted background style (for span/step collapsible regions). */
  muted?: boolean;
  /** Depth of the event in the tree (0 = root). */
  depth?: number;
  /** Inline content rendered between the title and the trailing nav/turn label (e.g. retry chip on retried model events). */
  headerExtra?: ReactNode;
  /** Collapse state and deep-link callbacks from the app store. */
  eventCallbacks?: EventPanelCallbacks;
}

interface ChildProps {
  "data-name"?: string;
}

/**
 * Renders a collapsible event panel with optional tabs, icons, and deep linking.
 */
export const EventPanel: FC<EventPanelProps> = ({
  eventNodeId,
  className,
  title,
  subTitle,
  text,
  icon,
  children,
  childIds,
  collapsibleContent,
  collapseControl = "top",
  muted,
  depth,
  headerExtra,
  eventCallbacks,
}) => {
  const { onCollapse, getCollapsed, getEventUrl, linkingEnabled } =
    eventCallbacks ?? {};
  const eventLabel = useContext(EventLabelContext);
  const externalCollapsed = getCollapsed?.(eventNodeId) ?? false;
  const collapsed = externalCollapsed;

  const setCollapsed = useCallback(
    (value: boolean) => {
      onCollapse?.(eventNodeId, value);
    },
    [onCollapse, eventNodeId]
  );

  const isCollapsible = (childIds || []).length > 0 || collapsibleContent;
  const useBottomDongle = isCollapsible && collapseControl === "bottom";

  const url =
    linkingEnabled && getEventUrl ? getEventUrl(eventNodeId) : undefined;

  const pillId = (index: number) => `${eventNodeId}-nav-pill-${index}`;

  const filteredArrChildren = (
    Array.isArray(children) ? children : [children]
  ).filter(Boolean);

  const defaultPill = filteredArrChildren.findIndex(
    (node) => hasDataDefault(node) && node.props["data-default"]
  );
  const defaultPillId = defaultPill !== -1 ? pillId(defaultPill) : pillId(0);

  // The pill nav and the collapsed-summary text share the same right-aligned
  // cell — they never appear together (summary text is only supplied for
  // single-child panels, which have no tabs).
  const showNavs =
    !(isCollapsible && collapsibleContent && collapsed) &&
    filteredArrChildren.length > 1;

  const [storedNav, setStoredNav] = useProperty(eventNodeId, "selectedNav", {
    defaultValue: defaultPillId,
  });

  // On the single-event focus page a shared tab (by NAME) is remembered across
  // events, so navigating between turns keeps the same tab open instead of each
  // event reverting to its own per-event selection. Absent in the main
  // transcript, where each panel keeps its own `selectedNav`.
  const focusTab = useContext(FocusTabContext);
  const tabNameAt = (index: number): string | undefined => {
    const child = filteredArrChildren[index];
    return child && isValidElement<ChildProps>(child)
      ? child.props["data-name"]
      : undefined;
  };
  const focusActive = !!focusTab && filteredArrChildren.length > 1;
  // Pill for the shared tab name; falls back to the first pill when this event
  // doesn't have that tab (e.g. remembered "API" on a panel without an API tab).
  const focusSelectedNav = pillId(
    Math.max(
      0,
      filteredArrChildren.findIndex(
        (node) =>
          isValidElement<ChildProps>(node) &&
          node.props["data-name"] === focusTab?.tab
      )
    )
  );
  const selectedNav = focusActive ? focusSelectedNav : storedNav;
  const setSelectedNav = (target: string) => {
    if (focusActive && focusTab) {
      const name = tabNameAt(Number(target.slice(target.lastIndexOf("-") + 1)));
      if (name) focusTab.setTab(name);
    } else {
      setStoredNav(target);
    }
  };

  const stickyRef = useRef<HTMLDivElement>(null);
  const { stickyTop } = useStickyScroll();

  const gridColumns: string[] = [];

  // chevron
  if (isCollapsible && !useBottomDongle) {
    gridColumns.push("minmax(0, max-content)");
  }

  // icon
  if (icon) {
    gridColumns.push("max-content");
  }

  // title (carries copy-link + headerExtra so they wrap with the title)
  gridColumns.push("minmax(0, max-content)");
  // navs/summary: 1fr so the cell always spans the row's free space. With an
  // `auto` track it collapses to the picker's width once collapsed, and the
  // measured width can then never grow back to the pill row's natural width —
  // so the picker can never expand to tabs again.
  gridColumns.push("minmax(0, 1fr)");
  // search/reference label — far-right pill, like message numbering
  if (eventLabel) {
    gridColumns.push("max-content");
  }

  const toggleCollapse = useCallback(() => {
    setCollapsed(!collapsed);
  }, [setCollapsed, collapsed]);

  const [mouseOver, setMouseOver] = useState(false);

  const titleEl = (
    <div
      title={subTitle}
      className={clsx(
        "text-size-small",
        mouseOver ? styles.hover : "",
        styles.stickyWrapper
      )}
      ref={stickyRef}
      style={{
        display: "grid",
        gridTemplateColumns: gridColumns.join(" "),
        columnGap: "0.3em",
        alignItems: "center",
        cursor: isCollapsible && !useBottomDongle ? "pointer" : undefined,
        // Sticky pin position (the `.stickyWrapper` class supplies
        // `position: sticky`); offset comes from the StickyScrollContext.
        top: stickyTop,
      }}
      onMouseEnter={() => setMouseOver(true)}
      onMouseLeave={() => setMouseOver(false)}
    >
      {isCollapsible && !useBottomDongle ? (
        <i
          onClick={toggleCollapse}
          className={collapsed ? kChevronRight : kChevronDown}
        />
      ) : (
        ""
      )}
      {icon ? (
        <i
          className={clsx(icon || kDefaultIcon, "text-style-secondary")}
          onClick={toggleCollapse}
        />
      ) : (
        ""
      )}
      <div
        className={clsx(
          "text-style-secondary",
          "text-style-label",
          styles.title
        )}
        onClick={toggleCollapse}
      >
        <span>{title}</span>
        {headerExtra ? (
          <span
            className={styles.titleExtra}
            onClick={(e) => e.stopPropagation()}
          >
            {headerExtra}
          </span>
        ) : null}
        {url ? (
          <span onClick={(e) => e.stopPropagation()}>
            <CopyButton
              value={url}
              icon={kLinkIcon}
              className={clsx(styles.copyLink)}
            />
          </span>
        ) : null}
      </div>
      <div
        className={styles.navs}
        onClick={showNavs ? undefined : toggleCollapse}
      >
        {showNavs ? (
          <EventNavs
            navs={filteredArrChildren.map((child, index) => {
              const defaultTitle = `Tab ${index}`;
              const title =
                child && isValidElement<ChildProps>(child)
                  ? child.props["data-name"] || defaultTitle
                  : defaultTitle;
              return {
                id: `eventpanel-${eventNodeId}-${index}`,
                title: title,
                target: pillId(index),
              };
            })}
            selectedNav={selectedNav || ""}
            setSelectedNav={setSelectedNav}
          />
        ) : collapsed && text ? (
          <span className={clsx("text-style-secondary", styles.label)}>
            {text}
          </span>
        ) : null}
      </div>
      {eventLabel && (
        <MessageLabel label={eventLabel} className={styles.eventLabel} />
      )}
    </div>
  );

  // Determine root styling: depth === 0 or muted flag
  const isRoot = depth === 0 || muted;

  // A gutter (see `.expanded`) marks an event showing non-summary detail, so its
  // expanded extent stays visible while scrolling past it. For tabbed panels
  // that means a non-default (non-summary) tab is open; for single-content
  // panels it means the content is expanded. The summary/default view shows no
  // gutter.
  const hasTabs = filteredArrChildren.length > 1;
  const detailExpanded = hasTabs
    ? !collapsed && selectedNav !== defaultPillId
    : !!collapsibleContent && !collapsed;

  const card = (
    <div
      id={`event-panel-${eventNodeId}`}
      className={clsx(
        className,
        styles.card,
        isRoot ? styles.root : undefined,
        detailExpanded ? styles.expanded : undefined
      )}
    >
      {titleEl}
      <div
        className={clsx(
          "tab-content",
          styles.cardContent,
          isCollapsible && collapsed && collapsibleContent
            ? styles.hidden
            : undefined
        )}
      >
        {filteredArrChildren?.map((child, index) => {
          const id = pillId(index);
          const isSelected = id === selectedNav;

          // Only render the selected tab (ported from inspect for better perf)
          if (!isSelected) {
            return null;
          }

          return (
            <div
              key={`children-${id}-${index}`}
              id={id}
              className={clsx("tab-pane", "show", isSelected ? "active" : "")}
            >
              {child}
            </div>
          );
        })}
      </div>
      {isCollapsible && useBottomDongle ? (
        <div
          className={clsx(styles.bottomDongle, "text-size-smallest")}
          onClick={toggleCollapse}
        >
          <i
            className={clsx(
              collapsed ? kChevronRight : kChevronDown,
              styles.dongleIcon
            )}
          />
          transcript ({childIds?.length}{" "}
          {childIds?.length === 1 ? "event" : "events"})
        </div>
      ) : undefined}
    </div>
  );
  return card;
};

// Typeguard for reading default value from pills
interface DataDefaultProps {
  "data-default"?: boolean;
  [key: string]: unknown;
}

function hasDataDefault(
  node: ReactNode
): node is ReactElement<DataDefaultProps> {
  return (
    isValidElement(node) &&
    node.props !== null &&
    typeof node.props === "object" &&
    "data-default" in node.props
  );
}
