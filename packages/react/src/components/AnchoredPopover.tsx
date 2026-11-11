import clsx from "clsx";
import {
  CSSProperties,
  FC,
  HTMLAttributes,
  Ref,
  ToggleEvent,
  useId,
  useRef,
} from "react";

import { useAnchoredPopover } from "../hooks/useAnchoredPopover";

import styles from "./AnchoredPopover.module.css";

export type PopoverPlacement =
  | "auto"
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"
  | "right"
  | "right-start"
  | "right-end";

type Side = "top" | "bottom" | "left" | "right";

const POSITION_AREA: Record<PopoverPlacement, string> = {
  auto: "bottom",
  top: "top",
  "top-start": "top span-right",
  "top-end": "top span-left",
  bottom: "bottom",
  "bottom-start": "bottom span-right",
  "bottom-end": "bottom span-left",
  left: "left",
  "left-start": "left span-bottom",
  "left-end": "left span-top",
  right: "right",
  "right-start": "right span-bottom",
  "right-end": "right span-top",
};

// The margin on the side facing the anchor; flip-block / flip-inline swap it
// along with the placement.
const OFFSET_MARGIN = {
  top: "marginBottom",
  bottom: "marginTop",
  left: "marginRight",
  right: "marginLeft",
} as const;

const sideOf = (placement: PopoverPlacement): Side => {
  const side = placement.split("-")[0];
  return side === "top" || side === "left" || side === "right"
    ? side
    : "bottom";
};

export interface AnchoredPopoverProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "popover" | "onToggle" | "onBeforeToggle"
> {
  /** Renders the popover while true. */
  open: boolean;
  /** Called when the browser closes the popover: light dismiss or Escape. */
  onClose: () => void;
  /** The element the popover is positioned against. Nothing renders while null. */
  anchor: HTMLElement | null;
  /**
   * The control that opens the popover, when it isn't `anchor`. Tab moves
   * from it into the popover, and focus returns to it on close.
   */
  trigger?: HTMLElement | null;
  /**
   * `auto` popovers close on an outside click or Escape and close other
   * `auto` popovers that aren't their ancestors. `manual` leaves all closing
   * to the caller.
   */
  mode?: "auto" | "manual";
  placement?: PopoverPlacement;
  /** Gap between the anchor and the popover, in px. */
  offset?: number;
  /** Draws an arrow from the popover toward the anchor. */
  arrow?: boolean;
  /** Receives the popover element while it's open. Must keep its identity. */
  ref?: Ref<HTMLDivElement>;
}

/**
 * A floating panel in the browser's top layer, positioned with CSS anchor
 * positioning: it stays attached to `anchor` through scrolling and resizing,
 * flips to the opposite side when it doesn't fit, and is never clipped by an
 * ancestor's overflow or stacking order.
 *
 * It renders in place rather than through a portal, so it stays inside an
 * enclosing modal `<dialog>`'s subtree and remains interactive there.
 */
export const AnchoredPopover: FC<AnchoredPopoverProps> = ({
  open,
  ...props
}) => {
  if (!open || !props.anchor) return null;
  return (
    <OpenPopover
      {...props}
      anchor={props.anchor}
      trigger={props.trigger ?? props.anchor}
    />
  );
};

const OpenPopover: FC<
  Omit<AnchoredPopoverProps, "open"> & {
    anchor: HTMLElement;
    trigger: HTMLElement;
  }
> = ({
  onClose,
  anchor,
  trigger,
  mode = "auto",
  placement = "bottom",
  offset = 8,
  arrow = false,
  ref: forwardRef,
  className,
  style,
  children,
  ...rest
}) => {
  const restoreFocusOnClose = useRef(false);
  const uid = useId().replace(/[^\w-]/g, "");
  const anchorName = `--popover-anchor-${uid}`;
  const selfName = `--popover-${uid}`;
  const { ref, shown } = useAnchoredPopover(
    anchor,
    trigger,
    anchorName,
    forwardRef
  );

  const side = sideOf(placement);

  const handleBeforeToggle = (e: ToggleEvent<HTMLDivElement>) => {
    if (e.newState === "closed") {
      restoreFocusOnClose.current = e.currentTarget.contains(
        document.activeElement
      );
    }
  };
  const handleToggle = (e: ToggleEvent<HTMLDivElement>) => {
    if (e.newState !== "closed") return;
    // Escape restores focus to whatever was focused when the popover opened,
    // which isn't the trigger in Safari (clicks don't focus buttons there).
    if (restoreFocusOnClose.current) trigger.focus({ preventScroll: true });
    onClose();
  };

  return (
    <div
      {...rest}
      ref={ref}
      popover={mode}
      className={clsx(styles.popover, className)}
      style={{
        positionAnchor: anchorName,
        anchorName: selfName,
        positionArea: POSITION_AREA[placement],
        [OFFSET_MARGIN[side]]: offset,
        ...style,
      }}
      onBeforeToggle={handleBeforeToggle}
      onToggle={handleToggle}
    >
      {shown && children}
      {shown && arrow && (
        <Arrows
          vertical={side === "top" || side === "bottom"}
          anchorName={anchorName}
          selfName={selfName}
        />
      )}
    </div>
  );
};

/**
 * One arrow per side of the anchor on the placement axis. Each fills the gap
 * between the anchor and the popover only when the popover is on its side;
 * otherwise its insets cross and it collapses to nothing. That keeps the
 * arrow correct when position-try flips the popover, without an anchored
 * container query (unsupported in Firefox and Safari).
 */
const Arrows: FC<{
  vertical: boolean;
  anchorName: string;
  selfName: string;
}> = ({ vertical, anchorName: a, selfName: p }) => {
  // The arrow overlaps the popover's 1px border so its fill hides the border
  // under the arrow's base.
  const along = vertical
    ? {
        left: `clamp(anchor(${p} left) + 4px, anchor(${a} center) - 8px, anchor(${p} right) - 20px)`,
      }
    : {
        top: `clamp(anchor(${p} top) + 4px, anchor(${a} center) - 8px, anchor(${p} bottom) - 20px)`,
      };
  const sides: Array<[string, CSSProperties]> = vertical
    ? [
        [
          styles.up,
          {
            top: `anchor(${a} bottom)`,
            bottom: `calc(anchor(${p} top) - 1px)`,
          },
        ],
        [
          styles.down,
          {
            top: `calc(anchor(${p} bottom) - 1px)`,
            bottom: `anchor(${a} top)`,
          },
        ],
      ]
    : [
        [
          styles.left,
          {
            left: `anchor(${a} right)`,
            right: `calc(anchor(${p} left) - 1px)`,
          },
        ],
        [
          styles.right,
          {
            left: `calc(anchor(${p} right) - 1px)`,
            right: `anchor(${a} left)`,
          },
        ],
      ];
  return sides.map(([direction, inset]) => (
    <span
      key={direction}
      aria-hidden="true"
      className={clsx(styles.arrow, direction)}
      style={{ ...inset, ...along }}
    />
  ));
};
