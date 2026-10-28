import clsx from "clsx";
import {
  createContext,
  CSSProperties,
  FC,
  memo,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { useCollapsedState, useResizeObserver } from "../hooks";

import styles from "./ExpandablePanel.module.css";
import { useFindTarget } from "./FindTargetContext";

// Toggle bar height (20px, see `.moreToggle`) plus a gap. A nested toggle
// lifts its sticky `bottom` by this per ancestor toggle on the same side, and
// a panel reserves this much space below a nested toggle that would otherwise
// share its corner.
const kNestedToggleStep = 24;

// A ref callback that returns its own cleanup (React 19, so it is never
// called with null; the type still admits it). Each panel chains it to its
// ancestors, so every panel sees all inline toggles below it.
type RegisterNestedToggle = (
  holder: HTMLElement | null
) => (() => void) | undefined;

// Ancestors measure this subtree to decide whether they overflow, so nothing
// derived from an ancestor's measurement may change this subtree's layout:
// that feeds back into the measurement and oscillates. Only paint-level
// properties (sticky offsets) may depend on it.
interface PanelNesting {
  // Ancestor toggles showing on each side; stuck toggles stack above them.
  rightToggles: number;
  leftToggles: number;
  registerNestedToggle: RegisterNestedToggle | null;
}

const PanelNestingContext = createContext<PanelNesting>({
  rightToggles: 0,
  leftToggles: 0,
  registerNestedToggle: null,
});

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

    const nestedToggles = useRef(new Set<HTMLElement>());
    const [nestedToggleAtCorner, setNestedToggleAtCorner] = useState(false);
    // A nested inline toggle rests at its panel's bottom-right corner. If that
    // corner is within one toggle of our content's bottom, our toggle would
    // rest on top of it.
    const measureNestedToggles = useCallback((content: Element) => {
      const bottom = content.getBoundingClientRect().bottom;
      let atCorner = false;
      for (const holder of nestedToggles.current) {
        const gap = bottom - holder.getBoundingClientRect().bottom;
        if (gap > -1 && gap < kNestedToggleStep) {
          atCorner = true;
          break;
        }
      }
      setNestedToggleAtCorner(atCorner);
    }, []);

    const checkOverflow = useCallback(
      (entry: ResizeObserverEntry) => {
        const element = entry.target;
        if (!(element instanceof HTMLElement)) return;

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
        measureNestedToggles(element);
      },
      [lines, measureNestedToggles]
    );
    const contentRef = useResizeObserver(checkOverflow);

    const findTarget = useFindTarget();
    // Initialize optimistically: if there's an active find target when we
    // mount, assume our subtree contains it and render expanded immediately.
    // The post-render effect below will collapse us back if the term isn't
    // actually present. This swaps a "collapsed→expanded" flash on remount
    // (which the user sees on every search step as the virtual list re-renders) for
    // a much rarer "expanded→collapsed" flash on panels that don't match.
    const [containsFindTarget, setContainsFindTarget] = useState(
      () => findTarget !== null
    );

    // No dep array: intentionally re-runs after every render so that changes
    // in children text (e.g. lazily loaded content) are picked up without an
    // additional mechanism.
    // eslint-disable-next-line react-hooks/exhaustive-deps, tsmono/no-raw-use-effect -- intentional: re-run after every render to track subtree text changes
    useEffect(() => {
      if (!findTarget) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing React state with DOM subtree text; no external subscription possible
        setContainsFindTarget(false);
        return;
      }
      const root = contentRef.current;
      if (!root) {
        setContainsFindTarget(false);
        return;
      }
      const text = root.textContent.toLowerCase();
      setContainsFindTarget(text.includes(findTarget.term.toLowerCase()));
    });

    const effectiveCollapsed = containsFindTarget ? false : collapsed;

    const nesting = useContext(PanelNestingContext);
    const parentRegister = nesting.registerNestedToggle;
    // Stable identity is a correctness requirement, not an optimization:
    // descendants use this as a ref callback, and a new identity per render
    // would unregister/re-register (and re-measure) on every commit.
    const registerNestedToggle = useCallback<RegisterNestedToggle>(
      (holder) => {
        if (!holder) return undefined;
        const remeasure = () => {
          if (contentRef.current) measureNestedToggles(contentRef.current);
        };
        nestedToggles.current.add(holder);
        remeasure();
        const unregisterParent = parentRegister?.(holder);
        return () => {
          nestedToggles.current.delete(holder);
          remeasure();
          unregisterParent?.();
        };
      },
      [parentRegister, measureNestedToggles, contentRef]
    );
    const childNesting: PanelNesting = {
      rightToggles:
        nesting.rightToggles +
        (showToggle && layout === "inline-right" ? 1 : 0),
      leftToggles:
        nesting.leftToggles + (showToggle && layout === "block-left" ? 1 : 0),
      registerNestedToggle,
    };
    // Sticky `bottom` only applies while stuck, so at rest every toggle still
    // sits in its own panel's corner; while stuck, nested ones stack upward.
    const togglesBelow =
      layout === "inline-right" ? nesting.rightToggles : nesting.leftToggles;
    const stickyStyle: CSSProperties | undefined =
      togglesBelow > 0
        ? { bottom: `calc(0.25em + ${togglesBelow * kNestedToggleStep}px)` }
        : undefined;
    const reserveNestedToggleStrip =
      showToggle &&
      layout === "inline-right" &&
      !effectiveCollapsed &&
      nestedToggleAtCorner;

    // `overflow: hidden` + `maxHeight` live on the inner content wrapper, not
    // the outer panel. Two reasons:
    //   1. Keeping it off the panel when expanded prevents the panel from
    //      becoming a "scroll container" that would trap the sticky toggle.
    //   2. Putting them on the wrapper means the wrapper's box matches the
    //      visible (clipped) area, so a `mask-image` gradient on the wrapper
    //      fades the bottom of the *visible* region — not the bottom of the
    //      natural-height content (which would sit off-screen).
    // `contain: layout paint` isolates the collapsed subtree so the browser
    // does not lay out, paint, or *layerize* the clipped overflow. Without it,
    // a pathologically tall child (e.g. a multi-megabyte tool result that
    // renders ~1,000,000px tall) forces the compositor to build a layer for
    // the entire natural height on every resize — observed as ~1.4s per
    // `Layerize` call, wedging the main thread (laggy in Blink, spinlocks
    // WebKit). `size` containment is intentionally omitted so the box still
    // sizes to `maxHeight`.
    const contentStyles: CSSProperties = effectiveCollapsed
      ? {
          overflow: "hidden",
          maxHeight: `${lines}rem`,
          contain: "layout paint",
        }
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
          data-expandable-panel="true"
          className={clsx(
            styles.expandablePanel,
            border ? styles.expandableBordered : undefined,
            className
          )}
        >
          <div
            ref={contentRef}
            style={contentStyles}
            className={clsx(
              effectiveCollapsed ? styles.collapsedContent : undefined,
              effectiveCollapsed && showToggle
                ? styles.expandableTruncated
                : undefined
            )}
          >
            <PanelNestingContext.Provider value={childNesting}>
              {children}
            </PanelNestingContext.Provider>
          </div>
          {reserveNestedToggleStrip && (
            <div
              data-nested-toggle-strip="true"
              style={{ height: kNestedToggleStep }}
            />
          )}
          {showToggle && layout === "inline-right" && (
            <div
              ref={parentRegister ?? undefined}
              className={styles.inlineToggleHolder}
            >
              <div className={styles.inlineToggleSticky} style={stickyStyle}>
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
            style={stickyStyle}
          />
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
        type="button"
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
