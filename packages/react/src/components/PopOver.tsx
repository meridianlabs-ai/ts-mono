import clsx from "clsx";
import { CSSProperties, FC, ReactNode, useState } from "react";

import { useEventListener } from "../hooks/useEventListener";
import { usePointerRest } from "../hooks/usePointerRest";
import { useTimeout } from "../hooks/useTimeout";

import { AnchoredPopover, PopoverPlacement } from "./AnchoredPopover";

interface PopOverProps {
  id: string;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  positionEl: HTMLElement | null;
  /** The control that opens the popover, when it isn't `positionEl`. */
  triggerEl?: HTMLElement | null;
  placement?: PopoverPlacement;
  showArrow?: boolean;
  /** Gap between `positionEl` and the popover, in px. */
  offset?: number;
  /**
   * With a positive delay, the popover is a hover card: it shows once the
   * pointer rests on `positionEl` for this long and hides when the pointer
   * leaves both. Otherwise it shows as soon as `isOpen` is set and closes on
   * an outside click or Escape.
   */
  hoverDelay?: number;
  /** Close when the pointer leaves the popover. */
  closeOnMouseLeave?: boolean;

  className?: string | string[];

  children: ReactNode;
  styles?: CSSProperties;
}

// How long the pointer may spend between the trigger and a hover card
// before the card hides.
const HOVER_LEAVE_GRACE_MS = 300;

const panelStyle: CSSProperties = {
  backgroundColor: "var(--bs-body-bg)",
  padding: "12px",
  borderRadius: "var(--bs-border-radius)",
  boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
  border: "solid 1px var(--bs-border-color)",
  overflowY: "hidden",
};

/**
 * A controlled floating panel positioned against `positionEl`.
 */
export const PopOver: FC<PopOverProps> = ({
  id,
  isOpen,
  setIsOpen,
  positionEl,
  triggerEl,
  children,
  placement = "bottom",
  showArrow = true,
  offset = 8,
  className = "",
  hoverDelay = 250,
  closeOnMouseLeave = true,
  styles = {},
}) => {
  const hover = hoverDelay > 0;
  const [hoverShown, setHoverShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [popover, setPopover] = useState<HTMLDivElement | null>(null);

  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setHoverShown(false);
      setLeaving(false);
    }
  }

  const close = () => {
    setHoverShown(false);
    setLeaving(false);
    setIsOpen(false);
  };

  const hoverTarget = hover && isOpen ? positionEl : null;
  usePointerRest(hoverShown ? null : hoverTarget, hoverDelay, () =>
    setHoverShown(true)
  );
  useEventListener(hoverTarget, "mouseleave", () => setLeaving(true));
  useEventListener(hoverTarget, "mouseenter", () => setLeaving(false));
  useTimeout(close, leaving ? HOVER_LEAVE_GRACE_MS : null);

  // Native listeners rather than React's onMouseEnter/onMouseLeave: React
  // derives those from mouseout/mouseover pairs, and when the pointer jumps
  // from the trigger into the popover Safari can report them so that React
  // dispatches no enter, letting the leave grace period close the card.
  useEventListener(popover, "mouseenter", () => setLeaving(false));
  useEventListener(popover, "mouseleave", () => {
    if (closeOnMouseLeave) close();
  });

  // Hover cards are `manual` popovers, so they don't close an open menu, and
  // need their own outside-press dismissal. Popovers nested in this one
  // render inside it, so presses in them count as inside.
  useEventListener(hover && hoverShown ? document : null, "mousedown", (e) => {
    if (e.target instanceof Node && popover?.contains(e.target)) return;
    close();
  });

  const visible = isOpen && (!hover || hoverShown);

  return (
    <AnchoredPopover
      open={visible}
      onClose={close}
      anchor={positionEl}
      trigger={triggerEl}
      mode={hover ? "manual" : "auto"}
      placement={placement}
      offset={offset}
      arrow={showArrow}
      id={id}
      className={clsx(className)}
      style={{ ...panelStyle, ...styles }}
      ref={setPopover}
    >
      {children}
    </AnchoredPopover>
  );
};
