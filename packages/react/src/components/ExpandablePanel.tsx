import clsx from "clsx";
import {
  CSSProperties,
  FC,
  memo,
  ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

import { useCollapsedState, useResizeObserver } from "../hooks";

import styles from "./ExpandablePanel.module.css";

interface ExpandablePanelProps {
  id: string;
  collapse: boolean;
  border?: boolean;
  lines?: number;
  children?: ReactNode;
  className?: string | string[];
  togglePosition?: "inline-right" | "block-left";
}

export const ExpandablePanel: FC<ExpandablePanelProps> = memo(
  ({
    id,
    collapse,
    border,
    lines = 15,
    children,
    className,
    togglePosition: layout = "inline-right",
  }) => {
    const [collapsed, setCollapsed] = useCollapsedState(id, collapse);

    const [showToggle, setShowToggle] = useState(false);
    const rootFontSizeRef = useRef<number>(0);

    const checkOverflow = useCallback(
      (entry: ResizeObserverEntry) => {
        const element = entry.target as HTMLDivElement;

        // `maxHeight` is set in `rem` below, which resolves against the root
        // font-size — not the element's. Measuring against the element's own
        // font-size produced a too-small threshold whenever a caller shrunk
        // the font (e.g. via text-size-smaller), showing a toggle that did
        // not actually reveal any hidden content.
        if (rootFontSizeRef.current === 0) {
          const rootStyle = window.getComputedStyle(document.documentElement);
          rootFontSizeRef.current = parseFloat(rootStyle.fontSize);
        }
        const maxCollapsedHeight = rootFontSizeRef.current * lines;
        const contentHeight = element.scrollHeight;

        // 1px tolerance guards against sub-pixel rounding.
        setShowToggle(contentHeight - maxCollapsedHeight > 1);
      },
      [lines]
    );
    const contentRef = useResizeObserver(checkOverflow);

    // `overflow: hidden` is only needed when collapsed (to clip to maxHeight).
    // Leaving it on when expanded would make the panel a "scroll container"
    // for CSS sticky purposes, trapping the sticky toggle inside the panel
    // instead of letting it follow the outer viewport/scroll container.
    const baseStyles: CSSProperties = collapsed
      ? { overflow: "hidden", maxHeight: `${lines}rem` }
      : {};

    const handleToggle = useCallback(() => {
      const wasExpanded = !collapsed;
      // Capture pre-collapse geometry: only an expanded panel that was
      // taller than the viewport can strand the user — otherwise nothing
      // about the user's view changes when collapsing.
      const tallerThanViewport =
        wasExpanded &&
        !!contentRef.current &&
        contentRef.current.getBoundingClientRect().height > window.innerHeight;
      setCollapsed(!collapsed);
      if (tallerThanViewport) {
        // Wait for the next frame so the DOM reflects the collapsed
        // height, then align the panel's bottom with the viewport bottom.
        // `nearest` would be a no-op here: with the sticky toggle, part of
        // the panel was visible at click time, which short-circuits it.
        requestAnimationFrame(() => {
          contentRef.current?.scrollIntoView({
            block: "end",
            behavior: "smooth",
          });
        });
      }
    }, [collapsed, setCollapsed, contentRef]);

    return (
      <div className={clsx(styles.outer, className)}>
        <div
          style={baseStyles}
          ref={contentRef}
          data-expandable-panel="true"
          className={clsx(
            styles.expandablePanel,
            collapsed ? styles.expandableCollapsed : undefined,
            border ? styles.expandableBordered : undefined,
            className
          )}
        >
          {children}
          {showToggle && layout === "inline-right" && (
            <div className={styles.inlineToggleHolder}>
              <div className={styles.inlineToggleSticky}>
                <MoreToggle
                  collapsed={collapsed}
                  onToggle={handleToggle}
                  border={!border}
                  position="inline-right"
                />
              </div>
            </div>
          )}
        </div>
        {showToggle && layout === "block-left" && (
          <MoreToggle
            collapsed={collapsed}
            onToggle={handleToggle}
            border={!border}
            position="block-left"
          />
        )}

        {showToggle && layout === "inline-right" && (
          <div className={clsx(styles.separator)}></div>
        )}
      </div>
    );
  }
);

interface MoreToggleProps {
  collapsed: boolean;
  border: boolean;
  onToggle: () => void;
  style?: CSSProperties;
  position: "inline-right" | "block-left";
}

const MoreToggle: FC<MoreToggleProps> = ({
  collapsed,
  border,
  onToggle,
  style,
  position,
}) => {
  const text = collapsed ? "more" : "less";
  return (
    <div
      className={clsx(
        styles.moreToggle,
        border ? styles.bordered : undefined,
        position === "block-left" ? styles.blockLeft : undefined
      )}
      style={style}
    >
      <button
        className={clsx("btn", styles.moreToggleButton, "text-size-smallest")}
        onClick={onToggle}
      >
        {text}...
      </button>
    </div>
  );
};

ExpandablePanel.displayName = "ExpandablePanel";

export default ExpandablePanel;
