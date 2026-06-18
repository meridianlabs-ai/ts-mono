import { Modifier, Placement } from "@popperjs/core";
import clsx from "clsx";
import React, {
  CSSProperties,
  FC,
  MutableRefObject,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { usePopper } from "react-popper";

interface PopOverProps {
  id: string;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  positionEl: HTMLElement | null;
  placement?: Placement;
  offset?: [number, number];
  usePortal?: boolean;
  hoverDelay?: number;
  closeOnMouseLeave?: boolean;

  className?: string | string[];

  children: ReactNode;
  styles?: CSSProperties;
}

/**
 * A controlled Popper component for displaying content relative to a reference element
 */
export const PopOver: React.FC<PopOverProps> = ({
  id,
  isOpen,
  setIsOpen,
  positionEl,
  children,
  placement = "bottom",
  offset = [0, 8],
  className = "",
  usePortal = true,
  hoverDelay = 250,
  closeOnMouseLeave = true,
  styles = {},
}) => {
  const popperRef = useRef<HTMLDivElement | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );

  // For delayed hover functionality
  const [shouldShowPopover, setShouldShowPopover] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const isMouseMovingRef = useRef(false);
  const isOverPopoverRef = useRef(false);
  const dismissalTimerRef = useRef<number | null>(null);

  // Stable ref for setIsOpen to avoid re-running effects when the callback identity changes
  const setIsOpenRef = useRef(setIsOpen);
  // eslint-disable-next-line react-hooks/refs -- latest-callback ref pattern; rule doesn't model this
  setIsOpenRef.current = setIsOpen;

  // Setup hover timer and mouse movement detection
  useEffect(() => {
    const handleMouseMove = () => {
      isMouseMovingRef.current = true;

      // Clear any existing timer when mouse moves
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }

      // Start a new timer to check if mouse has stopped moving
      hoverTimerRef.current = window.setTimeout(() => {
        if (isOpen) {
          isMouseMovingRef.current = false;
          setShouldShowPopover(true);
        }
      }, hoverDelay);
    };

    const handleMouseLeave = () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
      isMouseMovingRef.current = false;

      // Add a delay before dismissing to allow user to move mouse to popover
      if (dismissalTimerRef.current !== null) {
        window.clearTimeout(dismissalTimerRef.current);
      }
      dismissalTimerRef.current = window.setTimeout(() => {
        if (!isOverPopoverRef.current) {
          setShouldShowPopover(false);
          setIsOpenRef.current(false);
        }
      }, 300);
    };

    const handleMouseDown = (event: MouseEvent) => {
      // Only cancel popover on mouse down outside the popover content
      if (
        popperRef.current &&
        !popperRef.current.contains(event.target as Node)
      ) {
        if (hoverTimerRef.current !== null) {
          window.clearTimeout(hoverTimerRef.current);
        }
        setShouldShowPopover(false);
        setIsOpenRef.current(false);
      }
    };

    if (!isOpen || hoverDelay <= 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- conditional sync of external prop, not cascading
      setShouldShowPopover(isOpen);

      // Track whether mousedown originated inside the popover or on the
      // trigger element. We use capture phase to detect this BEFORE the
      // event bubbles to portaled children.
      let mouseDownInsidePopover = false;
      let mouseDownOnTrigger = false;

      const captureListener = (event: MouseEvent) => {
        const target = event.target as Node;
        mouseDownInsidePopover = popperRef.current?.contains(target) ?? false;
        // A click on the trigger element should NOT close via this handler —
        // the trigger's own onClick will toggle the popover. Closing here
        // then reopening in the trigger handler would net to no change.
        mouseDownOnTrigger = positionEl?.contains(target) ?? false;
      };

      const bubbleListener = () => {
        if (!popperRef.current) return;
        if (mouseDownInsidePopover || mouseDownOnTrigger) return;
        setIsOpenRef.current(false);
      };

      // Capture phase fires first, before any children (including portaled ones)
      document.addEventListener("mousedown", captureListener, true);
      // Bubble phase fires after - by then we know if it started inside
      document.addEventListener("mousedown", bubbleListener);

      return () => {
        document.removeEventListener("mousedown", captureListener, true);
        document.removeEventListener("mousedown", bubbleListener);
      };
    }

    // Add event listeners to the positionEl (the trigger element)
    if (positionEl && isOpen) {
      positionEl.addEventListener("mousemove", handleMouseMove);
      positionEl.addEventListener("mouseleave", handleMouseLeave);

      // Add document-wide mousedown listener to dismiss on interaction outside popover
      document.addEventListener("mousedown", handleMouseDown);

      // Initial mouse move to start the timer
      handleMouseMove();
    } else {
      setShouldShowPopover(false);
    }

    return () => {
      if (positionEl) {
        positionEl.removeEventListener("mousemove", handleMouseMove);
        positionEl.removeEventListener("mouseleave", handleMouseLeave);
      }

      // Clean up the document mousedown listener
      document.removeEventListener("mousedown", handleMouseDown);

      // Clean up all timers to prevent leaks
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (dismissalTimerRef.current !== null) {
        window.clearTimeout(dismissalTimerRef.current);
        dismissalTimerRef.current = null;
      }
    };
  }, [isOpen, positionEl, hoverDelay]);

  // Create the portal container before the browser paints (useLayoutEffect,
  // not useEffect): a post-paint effect would let the first open commit
  // paint the popover inline at the trigger's DOM position.
  useLayoutEffect(() => {
    if (usePortal && isOpen && shouldShowPopover) {
      let container = document.getElementById(id);

      if (!container) {
        container = document.createElement("div");
        container.id = id;
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.zIndex = "9999";
        container.style.width = "0";
        container.style.height = "0";
        container.style.overflow = "visible";

        document.body.appendChild(container);
      }

      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing React with externally-created DOM node
      setPortalContainer(container);

      return () => {
        // Clean up only when unmounting or when the popover closes
        if (document.body.contains(container)) {
          document.body.removeChild(container);
          setPortalContainer(null);
        }
      };
    }

    return undefined;
  }, [usePortal, isOpen, shouldShowPopover, id]);

  // While the popover is shown, keep hovering over it from dismissing it.
  const handlePopoverMouseEnter = useCallback(() => {
    isOverPopoverRef.current = true;
    // Cancel any pending dismissal when mouse enters popover
    if (dismissalTimerRef.current !== null) {
      window.clearTimeout(dismissalTimerRef.current);
      dismissalTimerRef.current = null;
    }
    // Also cancel the hover delay timer
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    // Ensure popover stays visible
    setShouldShowPopover(true);
  }, []);

  const handlePopoverMouseLeave = useCallback(
    (e: MouseEvent) => {
      // Only dismiss if we're actually leaving the popover container
      // (currentTarget is the popover root the listener is attached to)
      const popperEl = e.currentTarget as HTMLElement;
      if (e.relatedTarget && popperEl.contains(e.relatedTarget as Node)) {
        return;
      }
      if (!closeOnMouseLeave) {
        return;
      }
      isOverPopoverRef.current = false;
      // Dismiss when leaving the popover
      setShouldShowPopover(false);
      setIsOpenRef.current(false);
    },
    [closeOnMouseLeave]
  );

  // Early return if not open or should not show due to hover delay
  if (!isOpen || (hoverDelay > 0 && !shouldShowPopover)) {
    return null;
  }

  // PopperBody mounts fresh on every open (the early return above unmounts
  // it on close), so usePopper's internal styles/attributes state can never
  // carry a previous open's coordinates into the first frame of the next.
  const popperContent = (
    <PopperBody
      popperRef={popperRef}
      positionEl={positionEl}
      placement={placement}
      offset={offset}
      className={className}
      styles={styles}
      onMouseEnter={handlePopoverMouseEnter}
      onMouseLeave={handlePopoverMouseLeave}
    >
      {children}
    </PopperBody>
  );

  // If using portal, render only once the (pre-paint) container exists
  if (usePortal) {
    return portalContainer
      ? createPortal(popperContent, portalContainer)
      : null;
  }

  // Otherwise render normally
  return popperContent;
};

interface PopperBodyProps {
  popperRef: MutableRefObject<HTMLDivElement | null>;
  positionEl: HTMLElement | null;
  placement: Placement;
  offset: [number, number];
  className: string | string[];
  styles: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: (e: MouseEvent) => void;
  children: ReactNode;
}

const PopperBody: FC<PopperBodyProps> = ({
  popperRef,
  positionEl,
  placement,
  offset,
  className,
  styles,
  onMouseEnter,
  onMouseLeave,
  children,
}) => {
  // State-backed popper element (not a ref read during render): attachment
  // re-renders, so usePopper always sees the real node and positions before
  // the gate below ever shows the popover.
  const [popperEl, setPopperEl] = useState<HTMLDivElement | null>(null);
  const setPopperNode = useCallback(
    (el: HTMLDivElement | null) => {
      popperRef.current = el;
      setPopperEl(el);
    },
    [popperRef]
  );

  const [offsetX, offsetY] = offset;

  // Popper modifier pair that caps the popover to the full viewport
  // (minus padding), not to whatever the popover currently happens to be.
  // Bounding the size up-front lets popper shift it freely to fit, avoiding
  // the "text unwraps → popper chases a moving width" race while still
  // giving the popover as much room as the viewport allows.
  //
  // The popper v2 community "maxSize" formula (width - overflow[side] - x)
  // collapses to the popper's current width once preventOverflow has shifted
  // it inside, so we derive the cap directly from the viewport — accurate
  // for a body-portal popover and placement-agnostic.
  const modifiers = useMemo(() => {
    const maxSizeModifier: Modifier<"maxSize", { padding: number }> = {
      name: "maxSize",
      enabled: true,
      phase: "main",
      requiresIfExists: ["offset", "preventOverflow", "flip"],
      options: { padding: 8 },
      fn({ state, name, options }) {
        const padding =
          typeof options?.padding === "number" ? options.padding : 8;
        state.modifiersData[name] = {
          width: Math.max(0, window.innerWidth - 2 * padding),
          height: Math.max(0, window.innerHeight - 2 * padding),
        };
      },
    };

    const applyMaxSizeModifier: Modifier<"applyMaxSize", object> = {
      name: "applyMaxSize",
      enabled: true,
      phase: "beforeWrite",
      requires: ["maxSize"],
      fn({ state }) {
        const data = state.modifiersData.maxSize as
          | { width: number; height: number }
          | undefined;
        if (!data) return;
        state.styles.popper = {
          ...state.styles.popper,
          maxWidth: `${data.width}px`,
          maxHeight: `${data.height}px`,
        };
      },
    };

    return [
      { name: "offset", options: { offset: [offsetX, offsetY] } },
      { name: "preventOverflow", options: { padding: 8 } },
      {
        name: "computeStyles",
        options: {
          gpuAcceleration: false,
          adaptive: true,
        },
      },
      // Ensure popper is positioned correctly with respect to its reference element
      {
        name: "flip",
        options: {
          fallbackPlacements: ["top", "right", "bottom", "left"],
        },
      },
      maxSizeModifier,
      applyMaxSizeModifier,
    ];
  }, [offsetX, offsetY]);

  const { styles: popperStyles, attributes } = usePopper(positionEl, popperEl, {
    placement,
    strategy: "fixed",
    modifiers,
  });

  // Popper sets data-popper-placement only once it has genuinely computed a
  // position; react-popper's initial styles are placeholder (top/left 0),
  // so gating visibility on the attribute is what prevents a first-frame
  // paint at the viewport's top-left corner.
  const positioned = attributes.popper?.["data-popper-placement"] != null;

  useEffect(() => {
    if (!popperEl) return;
    // Capture phase so we catch enter/leave before children
    popperEl.addEventListener("mouseenter", onMouseEnter, true);
    popperEl.addEventListener("mouseleave", onMouseLeave, true);
    return () => {
      popperEl.removeEventListener("mouseenter", onMouseEnter, true);
      popperEl.removeEventListener("mouseleave", onMouseLeave, true);
    };
  }, [popperEl, onMouseEnter, onMouseLeave]);

  const defaultPopperStyles: CSSProperties = {
    backgroundColor: "var(--inspect-background)",
    padding: "12px",
    borderRadius: "var(--inspect-radius)",
    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
    border: "solid 1px var(--inspect-border)",
    zIndex: 1200,
    // Smooth the appearance once positioned
    transition: "opacity 0.1s",
    maxWidth: "80%",
    maxHeight: "80%",
    // Scrolling lives on the inner content wrapper: flex + minHeight:0 is
    // what lets the maxHeight cap actually constrain it.
    display: "flex",
    flexDirection: "column",
  };

  const positionedStyle: CSSProperties = positioned
    ? {
        ...popperStyles.popper,
        opacity: 1,
        visibility: "visible",
      }
    : {
        // visibility: hidden is bulletproof — no paint regardless of what
        // placeholder values are in popperStyles.popper.
        visibility: "hidden",
        opacity: 0,
        position: "fixed",
        top: "-9999px",
        left: "-9999px",
      };

  return (
    <div
      ref={setPopperNode}
      style={{ ...defaultPopperStyles, ...positionedStyle, ...styles }}
      className={clsx(className)}
      {...attributes.popper}
    >
      <div style={{ overflow: "auto", minHeight: 0 }}>{children}</div>
    </div>
  );
};
