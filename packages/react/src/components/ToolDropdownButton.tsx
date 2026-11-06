import clsx from "clsx";
import {
  ButtonHTMLAttributes,
  forwardRef,
  ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useEventListener } from "../hooks/useEventListener";
import { Icon, IconName } from "../icons";

import styles from "./ToolDropdownButton.module.css";

/** A menu item with a rich label; `selected` marks the current choice. */
export interface ToolDropdownItem {
  key: string;
  label: ReactNode;
  selected?: boolean;
  onClick: () => void;
}

interface ToolDropdownButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string | ReactNode;
  icon?: IconName;
  /** Text labels mapped to actions, or items with rich labels. */
  items: Record<string, () => void> | ToolDropdownItem[];
  /** Small uppercase heading rendered above the items. */
  heading?: string;
  /** Trailing action rendered below a divider (e.g. "Clear selection"). */
  footer?: { label: string; icon?: IconName; onClick: () => void };
  dropdownAlign?: "left" | "right";
  dropdownClassName?: string | string[];
  subtle?: boolean;
  /** Visually hide the label (icon only) at narrow viewport widths. */
  collapseLabel?: boolean;
}

export const ToolDropdownButton = forwardRef<
  HTMLButtonElement,
  ToolDropdownButtonProps
>(
  (
    {
      label,
      icon,
      className,
      items,
      heading,
      footer,
      dropdownAlign = "left",
      dropdownClassName,
      subtle,
      collapseLabel,
      title,
      ...rest
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const [menuPosition, setMenuPosition] = useState<{
      top: number;
      left?: number;
      right?: number;
      minWidth: number;
    } | null>(null);

    const setRef = useCallback(
      (el: HTMLButtonElement | null) => {
        buttonRef.current = el;
        if (typeof ref === "function") {
          ref(el);
        } else if (ref && "current" in ref) {
          (ref as { current: HTMLButtonElement | null }).current = el;
        }
      },
      [ref]
    );

    const computePosition = useCallback(() => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const top = rect.bottom;
      const minWidth = rect.width;
      if (dropdownAlign === "right") {
        setMenuPosition({
          top,
          right: window.innerWidth - rect.right,
          minWidth,
        });
      } else {
        setMenuPosition({ top, left: rect.left, minWidth });
      }
    }, [dropdownAlign]);

    // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
    useLayoutEffect(() => {
      if (!isOpen) return;
      computePosition();
    }, [isOpen, computePosition]);

    // Re-compute on resize/scroll so the menu stays anchored to the button.
    const repositionTarget = isOpen ? window : null;
    useEventListener(repositionTarget, "resize", () => computePosition());
    useEventListener(repositionTarget, "scroll", () => computePosition(), {
      capture: true,
    });

    // The menu is portaled, so "is focus inside the menu" has to be asked of
    // the menu node itself rather than a wrapper around the trigger.
    const menuRef = useRef<HTMLDivElement | null>(null);

    useEventListener(
      isOpen ? document : null,
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        // This Escape closes the menu and nothing else: stop it here (the
        // capture-phase registration below runs first) so an enclosing
        // surface's own Escape handler — e.g. Modal's, on document bubble —
        // doesn't also fire and close both layers at once.
        e.stopPropagation();
        // Only pull focus back to the trigger when it was inside the menu —
        // Escape is a document listener, so it also fires from anywhere else.
        const refocus =
          menuRef.current?.contains(document.activeElement) ?? false;
        setIsOpen(false);
        if (refocus) buttonRef.current?.focus();
      },
      { capture: true }
    );

    const handleItemClick = (fn: () => void) => {
      fn();
      setIsOpen(false);
    };

    return (
      <>
        <button
          ref={setRef}
          type="button"
          className={clsx(
            "btn",
            "btn-tools",
            styles.toolButton,
            subtle ? styles.bodyColor : undefined,
            className
          )}
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title={
            title ??
            (collapseLabel && typeof label === "string" ? label : undefined)
          }
          {...rest}
        >
          {icon && (
            <Icon
              name={icon}
              className={collapseLabel ? styles.noMargin : undefined}
            />
          )}
          {collapseLabel ? (
            <span className={styles.collapsibleLabel}>{label}</span>
          ) : (
            label
          )}
          <Icon name="chevronDown" className={styles.chevron} />
        </button>
        {isOpen &&
          menuPosition &&
          createPortal(
            <>
              {/* Mouse-only dismissal; Escape closes the menu for keyboard users. */}
              <div
                className={styles.backdrop}
                role="presentation"
                onClick={() => setIsOpen(false)}
              />
              <div
                ref={menuRef}
                className={clsx(styles.dropdownMenu, dropdownClassName)}
                style={{
                  top: menuPosition.top,
                  left: menuPosition.left,
                  right: menuPosition.right,
                  minWidth: menuPosition.minWidth,
                }}
              >
                {heading ? (
                  <div className={styles.dropdownHeading}>{heading}</div>
                ) : null}
                {menuItems(items).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={clsx(
                      styles.dropdownItem,
                      item.selected && styles.dropdownItemSelected
                    )}
                    aria-current={item.selected ? "true" : undefined}
                    onClick={() => handleItemClick(item.onClick)}
                  >
                    {item.label}
                  </button>
                ))}
                {footer ? (
                  <>
                    <div className={styles.dropdownDivider} role="separator" />
                    <button
                      type="button"
                      className={clsx(
                        styles.dropdownItem,
                        styles.dropdownFooter
                      )}
                      onClick={() => handleItemClick(footer.onClick)}
                    >
                      {footer.icon ? <Icon name={footer.icon} /> : null}
                      {footer.label}
                    </button>
                  </>
                ) : null}
              </div>
            </>,
            document.body
          )}
      </>
    );
  }
);

ToolDropdownButton.displayName = "ToolDropdownButton";

const menuItems = (
  items: Record<string, () => void> | ToolDropdownItem[]
): ToolDropdownItem[] =>
  Array.isArray(items)
    ? items
    : Object.entries(items).map(([label, onClick]) => ({
        key: label,
        label,
        onClick,
      }));
