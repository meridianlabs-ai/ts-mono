import { FC, useState } from "react";

import { Icon, IconName } from "../icons";

import { AnchoredPopover } from "./AnchoredPopover";
import styles from "./MenuActionButton.module.css";

export interface MenuActionItem {
  label: string;
  value: string;
  icon?: IconName;
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
  const [showMenu, setShowMenu] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);

  const handleSelect = (value: string) => {
    setShowMenu(false);
    onSelect(value);
  };

  return (
    <div className={styles.wrapper}>
      <button
        ref={setTrigger}
        type="button"
        className={styles.iconButton}
        onClick={() => setShowMenu((prev) => !prev)}
        title={title}
        disabled={disabled}
        aria-expanded={showMenu}
      >
        <Icon name="threeDots" />
      </button>
      <AnchoredPopover
        open={showMenu}
        onClose={() => setShowMenu(false)}
        anchor={trigger}
        placement="bottom-end"
        offset={2}
        className={styles.menu}
      >
        {items.map((item) => (
          <button
            type="button"
            key={item.value}
            className={styles.menuItem}
            onClick={() => handleSelect(item.value)}
            disabled={item.disabled}
          >
            {item.icon && <Icon name={item.icon} />}
            {item.label}
          </button>
        ))}
      </AnchoredPopover>
    </div>
  );
};
