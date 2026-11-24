import clsx from "clsx";
import {
  ButtonHTMLAttributes,
  forwardRef,
  ReactNode,
  useCallback,
  useState,
} from "react";

import { Icon, IconName } from "../icons";

import { AnchoredPopover } from "./AnchoredPopover";
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
    const [button, setButton] = useState<HTMLButtonElement | null>(null);

    const setRef = useCallback(
      (el: HTMLButtonElement | null) => {
        setButton(el);
        if (typeof ref === "function") {
          ref(el);
        } else if (ref) {
          ref.current = el;
        }
      },
      [ref]
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
        <AnchoredPopover
          open={isOpen}
          onClose={() => setIsOpen(false)}
          anchor={button}
          placement={dropdownAlign === "right" ? "bottom-end" : "bottom-start"}
          offset={0}
          className={clsx(styles.dropdownMenu, dropdownClassName)}
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
                className={clsx(styles.dropdownItem, styles.dropdownFooter)}
                onClick={() => handleItemClick(footer.onClick)}
              >
                {footer.icon ? <Icon name={footer.icon} /> : null}
                {footer.label}
              </button>
            </>
          ) : null}
        </AnchoredPopover>
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
