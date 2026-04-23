import { Modifier, Placement } from "@popperjs/core";
import clsx from "clsx";
import React, {
  CSSProperties,
  ReactNode,
  useEffect,
  useLayoutEffect,
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
  showArrow?: boolean;
  offset?: [number, number];
  usePortal?: boolean;
  hoverDelay?: number;
  closeOnMouseLeave?: boolean;

  className?: string | string[];
  arrowClassName?: string | string[];

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
  showArrow = true,
  offset = [0, 8],
  className = "",
  arrowClassName = "",
  usePortal = true,
  hoverDelay = 250,
  closeOnMouseLeave = true,
  styles = {},
}) => {
  const popperRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<HTMLDivElement | null>(null);
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
        mouseDownInsidePopover =
          popperRef.current?.contains(target) ?? false;
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

  // Effect to create portal container when needed
  useEffect(() => {
    // Only create portal when the popover is open
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
  const maxSizeModifier = React.useMemo<
    Modifier<"maxSize", { padding: number }>
  >(
    () => ({
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
    }),
    []
  );

  const applyMaxSizeModifier = React.useMemo<
    Modifier<"applyMaxSize", object>
  >(
    () => ({
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
    }),
    []
  );

  // Configure modifiers for popper
  const modifiers = [
    { name: "offset", options: { offset } },
    { name: "preventOverflow", options: { padding: 8 } },
    {
      name: "arrow",
      enabled: showArrow,
      options: {
        // eslint-disable-next-line react-hooks/refs -- see meridianlabs-ai/ts-mono#90 (migrate to callback-ref + useState)
        element: arrowRef.current,
        padding: 5, // This keeps the arrow from getting too close to the corner
      },
    },
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

  // Use popper hook with modifiers
  const {
    styles: popperStyles,
    attributes,
    state,
    update,
    // eslint-disable-next-line react-hooks/refs -- see meridianlabs-ai/ts-mono#90 (migrate to callback-ref + useState)
  } = usePopper(positionEl, popperRef.current, {
    placement,
    strategy: "fixed",
    modifiers,
  });

  // Per-open-cycle "has popper positioned this open?" flag. react-popper's
  // internal useState (for styles/attributes) persists across open/close
  // cycles, so on the first render of a reopen the last open's top/left are
  // still in popperStyles — we'd paint at stale coordinates for one frame.
  //
  // useLayoutEffect (not useEffect) is critical here: in the same component,
  // usePopper's internal useLayoutEffect runs first (declared earlier) and
  // creates the popper instance + runs its first compute synchronously.
  // Our layout effect then runs, setPositionedThisOpen(true) triggers a
  // re-render, and all of this completes before the browser's first paint
  // after the open. So the first paint lands with the popover at its final
  // position — no offscreen frame, no flash.
  const [positionedThisOpen, setPositionedThisOpen] = useState(false);
  useLayoutEffect(() => {
    if (!isOpen) {
      setPositionedThisOpen(false);
    } else if (update) {
      setPositionedThisOpen(true);
    }
  }, [isOpen, update]);

  // Force update when needed refs change
  useEffect(() => {
    if (update && isOpen && shouldShowPopover) {
      // Need to delay the update slightly to ensure refs are properly set
      const timer = setTimeout(() => {
        void update();
      }, 10);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/refs -- arrowRef.current mutable read; see meridianlabs-ai/ts-mono#90
  }, [update, isOpen, shouldShowPopover, showArrow, arrowRef.current]);


  // When the popover is shown and positioned, track mouse enter/leave on the popover itself
  // and use that to block dismissal while hovering over the popover
  useEffect(() => {
    // Wait for both the popover to be visible AND Popper to have calculated positioning
    if (
      !popperRef.current ||
      !isOpen ||
      !shouldShowPopover ||
      !state?.placement
    ) {
      return;
    }

    const popperEl = popperRef.current;

    const handlePopoverMouseEnter = () => {
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
    };

    const handlePopoverMouseLeave = (e: MouseEvent) => {
      // Only dismiss if we're actually leaving the popover container
      // Check if the related target is still within the popover
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
    };

    // Use capture phase to ensure we catch events before children
    popperEl.addEventListener("mouseenter", handlePopoverMouseEnter, true);
    popperEl.addEventListener("mouseleave", handlePopoverMouseLeave, true);

    return () => {
      popperEl.removeEventListener("mouseenter", handlePopoverMouseEnter, true);
      popperEl.removeEventListener("mouseleave", handlePopoverMouseLeave, true);
    };
  }, [isOpen, shouldShowPopover, state?.placement, closeOnMouseLeave]);

  // Define arrow data-* attribute based on placement
  const getArrowDataPlacement = () => {
    if (!state || !state.placement) return placement;
    return state.placement;
  };

  // Get the actual placement from Popper state
  const actualPlacement = state?.placement || placement;

  // For a CSS triangle, we use the border trick
  // A CSS triangle doesn't need separate border styling like a rotated square would

  // Popper container styles
  const defaultPopperStyles: CSSProperties = {
    backgroundColor: "var(--bs-body-bg)",
    padding: "12px",
    borderRadius: "var(--bs-border-radius)",
    boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
    border: "solid 1px var(--bs-border-color)",
    zIndex: 1200,
    position: "relative",
    // Apply opacity transition to smooth the appearance
    opacity: state?.placement ? 1 : 0,
    transition: "opacity 0.1s",
    maxWidth: "80%",
    maxHeight: "80%",
    overflowY: "hidden",
  };

  // Early return if not open or should not show due to hover delay
  if (!isOpen || (hoverDelay > 0 && !shouldShowPopover)) {
    return null;
  }

  // For position-aware rendering. Use the per-open-cycle flag rather than
  // react-popper state, which persists styles across open/close cycles and
  // would otherwise cause paints at stale or placeholder coordinates on the
  // first render of any open.
  const popperReady = positionedThisOpen;
  const positionedStyle = popperReady
    ? {
        ...popperStyles.popper,
        opacity: 1,
        visibility: "visible" as const,
      }
    : {
        ...popperStyles.popper,
        // visibility: hidden is bulletproof — no paint regardless of what
        // position values are in popperStyles.popper (which may include
        // stale coordinates from a prior open since react-popper's useState
        // persists, or placeholder 0/0 on a brand-new instance).
        visibility: "hidden" as const,
        opacity: 0,
        position: "fixed" as const,
        top: "-9999px",
        left: "-9999px",
      };

  // Create the popper content with position-aware styles
  const popperContent = (
    <div
      ref={popperRef}
      style={{ ...defaultPopperStyles, ...positionedStyle, ...styles }}
      className={clsx(className)}
      {...attributes.popper}
    >
      {children}

      {showArrow && (
        <>
          {/* Invisible div for Popper.js to use as reference */}
          <div
            ref={arrowRef}
            style={{ position: "absolute", visibility: "hidden" }}
            data-placement={getArrowDataPlacement()}
          />

          {/* Arrow container - positioned by Popper */}
          <div
            className={clsx("popper-arrow-container", arrowClassName)}
            style={{
              ...popperStyles.arrow,
              position: "absolute",
              zIndex: 1,
              // Size and positioning based on placement - smaller arrow
              ...(actualPlacement.startsWith("top") && {
                bottom: "-8px",
                width: "16px",
                height: "8px",
              }),
              ...(actualPlacement.startsWith("bottom") && {
                top: "-8px",
                width: "16px",
                height: "8px",
              }),
              ...(actualPlacement.startsWith("left") && {
                right: "-8px",
                width: "8px",
                height: "16px",
              }),
              ...(actualPlacement.startsWith("right") && {
                left: "-8px",
                width: "8px",
                height: "16px",
              }),
              // Content positioning
              overflow: "hidden",
            }}
          >
            {/* Border element (rendered behind) */}
            {actualPlacement.startsWith("top") && (
              <div
                style={{
                  position: "absolute",
                  width: 0,
                  height: 0,
                  borderStyle: "solid",
                  borderWidth: "8px 8px 0 8px",
                  borderColor: "#eee transparent transparent transparent",
                  top: "0px",
                  left: "0px",
                }}
              />
            )}
            {actualPlacement.startsWith("bottom") && (
              <div
                style={{
                  position: "absolute",
                  width: 0,
                  height: 0,
                  borderStyle: "solid",
                  borderWidth: "0 8px 8px 8px",
                  borderColor: "transparent transparent #eee transparent",
                  top: "0px",
                  left: "0px",
                }}
              />
            )}
            {actualPlacement.startsWith("left") && (
              <div
                style={{
                  position: "absolute",
                  width: 0,
                  height: 0,
                  borderStyle: "solid",
                  borderWidth: "8px 0 8px 8px",
                  borderColor: "transparent transparent transparent #eee",
                  top: "0px",
                  left: "0px",
                }}
              />
            )}
            {actualPlacement.startsWith("right") && (
              <div
                style={{
                  position: "absolute",
                  width: 0,
                  height: 0,
                  borderStyle: "solid",
                  borderWidth: "8px 8px 8px 0",
                  borderColor: "transparent #eee transparent transparent",
                  top: "0px",
                  left: "0px",
                }}
              />
            )}

            {/* Actual triangle created with CSS borders, slightly smaller and offset to create border effect */}
            <div
              style={{
                position: "absolute",
                width: 0,
                height: 0,
                borderStyle: "solid",
                backgroundColor: "transparent",
                // Position relative to border triangle
                left: "0px",
                zIndex: 1,

                // Top placement - pointing down
                ...(actualPlacement.startsWith("top") && {
                  borderWidth: "7px 7px 0 7px",
                  borderColor: "white transparent transparent transparent",
                  top: "0px",
                }),

                // Bottom placement - pointing up
                ...(actualPlacement.startsWith("bottom") && {
                  borderWidth: "0 7px 7px 7px",
                  borderColor: "transparent transparent white transparent",
                  top: "1px",
                }),

                // Left placement - pointing right
                ...(actualPlacement.startsWith("left") && {
                  borderWidth: "7px 0 7px 7px",
                  borderColor: "transparent transparent transparent white",
                  left: "0px",
                }),

                // Right placement - pointing left
                ...(actualPlacement.startsWith("right") && {
                  borderWidth: "7px 7px 7px 0",
                  borderColor: "transparent white transparent transparent",
                  left: "1px",
                }),
              }}
            />
          </div>
        </>
      )}
    </div>
  );

  // If using portal and the container exists, render through the portal
  if (usePortal && portalContainer) {
    return createPortal(popperContent, portalContainer);
  }

  // Otherwise render normally
  return popperContent;
};
