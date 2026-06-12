import clsx from "clsx";
import {
  FC,
  isValidElement,
  ReactElement,
  ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

import { CopyButton } from "@tsmono/react/components";
import { useProperty } from "@tsmono/react/hooks";

import { MessageLabel } from "../../chat/MessageLabel";
import { EventLabelContext } from "../EventLabelContext";
import { useStickyObserver } from "../hooks/useStickyObserver";
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
  /** Turn label displayed in the header (e.g. "turn 1/3"). */
  turnLabel?: string;
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
  turnLabel,
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

  const [selectedNav, setSelectedNav] = useProperty(
    eventNodeId,
    "selectedNav",
    {
      defaultValue: defaultPillId,
    }
  );

  const stickyRef = useStickyObserver<HTMLDivElement>();

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
  gridColumns.push("minmax(0, 1fr)");
  gridColumns.push("minmax(0, max-content)");
  // navs: auto so it shrinks to picker mode when over-constrained
  gridColumns.push("auto");
  if (turnLabel) {
    gridColumns.push("max-content");
  }
  // search/reference label — far-right pill, like message numbering
  if (eventLabel) {
    gridColumns.push("max-content");
  }

  const toggleCollapse = useCallback(() => {
    setCollapsed(!collapsed);
  }, [setCollapsed, collapsed]);

  const [mouseOver, setMouseOver] = useState(false);

  const titleEl =
    eventLabel || title || icon || filteredArrChildren.length > 1 ? (
      <div
        title={subTitle}
        className={clsx(
          "text-size-small",
          mouseOver ? styles.hover : "",
          turnLabel ? styles.stickyWrapper : ""
        )}
        ref={turnLabel ? stickyRef : null}
        style={{
          display: "grid",
          gridTemplateColumns: gridColumns.join(" "),
          columnGap: "0.3em",
          cursor: isCollapsible && !useBottomDongle ? "pointer" : undefined,
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
        <div onClick={toggleCollapse}></div>
        <div
          className={clsx("text-style-secondary", styles.label)}
          onClick={toggleCollapse}
        >
          {collapsed ? text : ""}
        </div>
        <div className={styles.navs}>
          {isCollapsible && collapsibleContent && collapsed ? (
            ""
          ) : filteredArrChildren && filteredArrChildren.length > 1 ? (
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
          ) : (
            ""
          )}
        </div>
        {turnLabel && (
          <span className={clsx(styles.turnLabel)}>{turnLabel}</span>
        )}
        {eventLabel && <MessageLabel label={eventLabel} />}
      </div>
    ) : (
      ""
    );

  // Determine root styling: depth === 0 or muted flag
  const isRoot = depth === 0 || muted;

  const card = (
    <div
      id={`event-panel-${eventNodeId}`}
      className={clsx(className, styles.card, isRoot ? styles.root : undefined)}
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
