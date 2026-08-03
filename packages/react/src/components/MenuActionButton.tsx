import { FC, useEffect, useRef, useState } from "react";

import { useComponentIcons } from "./ComponentIconContext";
import styles from "./MenuActionButton.module.css";

export interface MenuActionItem {
  label: string;
  value: string;
  icon?: string;
  disabled?: boolean;
}

interface MenuActionButtonProps {
  items: MenuActionItem[];
  onSelect: (value: string) => void;
  disabled?: boolean;
  title?: string;
}

export const MenuActionButton: FC<MenuActionButtonProps> = ({
  items,
  onSelect,
  disabled,
  title,
}) => {
  const icons = useComponentIcons();
  const [showMenu, setShowMenu] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleSelect = (value: string) => {
    setShowMenu(false);
    onSelect(value);
  };

  useEffect(() => {
    if (!showMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // This Escape closes the menu and nothing else: stop it here (the
      // capture-phase registration below runs first) so an enclosing
      // surface's own Escape handler — e.g. Modal's, on document bubble —
      // doesn't also fire and close both layers at once.
      e.stopPropagation();
      // Only pull focus back to the trigger when it was inside the menu —
      // Escape is a document listener, so it also fires from anywhere else.
      const refocus =
        wrapperRef.current?.contains(document.activeElement) ?? false;
      setShowMenu(false);
      if (refocus) triggerRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [showMenu]);

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconButton}
        onClick={() => setShowMenu((prev) => !prev)}
        title={title}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={showMenu}
      >
        <i className={icons.menu} aria-hidden="true" />
      </button>
      {showMenu && (
        <>
          {/* Mouse-only dismissal; Escape closes the menu for keyboard users. */}
          <div
            className={styles.backdrop}
            role="presentation"
            onClick={() => setShowMenu(false)}
          />
          <div className={styles.menu}>
            {items.map((item) => (
              <button
                type="button"
                key={item.value}
                className={styles.menuItem}
                onClick={() => handleSelect(item.value)}
                disabled={item.disabled}
              >
                {item.icon && <i className={item.icon} />}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
