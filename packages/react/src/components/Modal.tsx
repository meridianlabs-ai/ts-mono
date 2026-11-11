import clsx from "clsx";
import { FC, ReactNode, useId, useRef } from "react";

import { useEventListener } from "../hooks/useEventListener";
import { useShowModal } from "../hooks/useShowModal";
import { Icon } from "../icons";

import { hasOpenPopover } from "./AnchoredPopover";
import styles from "./Modal.module.css";

const TEXT_INPUT_SELECTOR =
  'input:not([type="button"]):not([type="checkbox"]):not([type="color"]):not([type="file"]):not([type="image"]):not([type="radio"]):not([type="range"]):not([type="reset"]):not([type="submit"]),textarea,vscode-textfield';

const shouldSubmitOnEnter = (event: KeyboardEvent, dialog: Element) => {
  if (event.defaultPrevented) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target === dialog) return true;
  return target.matches(TEXT_INPUT_SELECTOR);
};

const OVERFLOW_CLASS: Record<NonNullable<ModalProps["overflow"]>, string> = {
  auto: styles.overflowAuto,
  hidden: styles.overflowHidden,
  scroll: styles.overflowScroll,
  visible: styles.overflowVisible,
};

interface ModalProps {
  show: boolean;
  onHide: () => void;
  onSubmit?: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  // Forwarded to the dialog element and used to derive the aria-labelledby id.
  id?: string;
  // Overrides the dialog max-width (e.g. "580px" or "min(1000px, 90vw)").
  width?: string;
  // Controls the body's overflow; default "auto" preserves prior behavior.
  overflow?: "auto" | "hidden" | "scroll" | "visible";
  // When false, removes the body's default padding (for edge-to-edge content).
  padded?: boolean;
  // Escape hatch for additional body styling.
  bodyClassName?: string;
}

/**
 * A modal `<dialog>`. The browser makes the rest of the page inert, keeps
 * focus inside, routes Escape to any popover open inside it first, and
 * returns focus on close. Every close path reports through `onHide`.
 */
export const Modal: FC<ModalProps> = ({ show, ...props }) =>
  show ? <OpenModal {...props} /> : null;

const OpenModal: FC<Omit<ModalProps, "show">> = ({
  onHide,
  onSubmit,
  title,
  children,
  footer,
  className,
  id,
  width,
  overflow = "auto",
  padded = true,
  bodyClassName,
}) => {
  const fallbackTitleId = useId();
  const titleId = id ? `${id}-title` : fallbackTitleId;
  const { ref, dialog } = useShowModal();
  // Safari closes a popover open inside the dialog on Escape and then also
  // sends the dialog a cancel for the same keypress.
  const escapeForPopover = useRef(false);

  useEventListener(
    dialog,
    "keydown",
    (e) => {
      escapeForPopover.current =
        e.key === "Escape" && !!dialog && hasOpenPopover(dialog);
    },
    { capture: true }
  );
  useEventListener(dialog, "keydown", (e) => {
    if (e.key !== "Enter" || !onSubmit || !dialog) return;
    if (!shouldSubmitOnEnter(e, dialog)) return;
    e.preventDefault();
    onSubmit();
  });

  return (
    <dialog
      ref={ref}
      id={id}
      aria-labelledby={titleId}
      className={styles.dialog}
      // Escape: stay open until the owner hides it.
      onCancel={(e) => {
        e.preventDefault();
        if (escapeForPopover.current) {
          escapeForPopover.current = false;
          return;
        }
        onHide();
      }}
      // A close the owner didn't ask for, e.g. Chrome closing anyway after
      // repeated Escapes that the cancel handler above prevented. The event
      // is queued, so skip it if the dialog has been reopened since (React
      // re-runs the ref that opens it in StrictMode).
      onClose={(e) => {
        if (!e.currentTarget.open) onHide();
      }}
    >
      {/* Dismissal is keyboard-accessible via Escape and the close button;
          the backdrop is a mouse-only convenience. A press that starts in
          the dialog and ends here clicks their common ancestor, not this. */}
      <div className={styles.backdrop} role="presentation" onClick={onHide} />
      <div
        className={clsx(styles.modal, className)}
        style={width ? { maxWidth: width } : undefined}
      >
        {/* Rendered with the dialog, so opening it focuses the close button
            (the first focusable element) unless something has autofocus. */}
        <div className={styles.header}>
          <h3 id={titleId} className={styles.title}>
            {title}
          </h3>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onHide}
            aria-label="Close"
          >
            <Icon name="close" />
          </button>
        </div>
        {dialog && (
          <>
            <div
              className={clsx(
                styles.body,
                OVERFLOW_CLASS[overflow],
                !padded && styles.noPadding,
                bodyClassName
              )}
            >
              {children}
            </div>
            {footer && <div className={styles.footer}>{footer}</div>}
          </>
        )}
      </div>
    </dialog>
  );
};
