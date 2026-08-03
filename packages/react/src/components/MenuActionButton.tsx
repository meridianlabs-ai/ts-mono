import { FC, useEffect, useState } from "react";

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

  const handleSelect = (value: string) => {
    setShowMenu(false);
    onSelect(value);
  };

  useEffect(() => {
    if (!showMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMenu(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showMenu]);

  return (
    <div className={styles.wrapper}>
      <button
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
