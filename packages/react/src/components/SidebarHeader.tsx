import { FC, ReactNode } from "react";

import { Icon, IconName } from "../icons";

import styles from "./SidebarHeader.module.css";

interface SidebarHeaderProps {
  icon?: IconName;
  title?: string;
  secondary?: string;
  actions?: ReactNode;
  onClose?: () => void;
}

export const SidebarHeader: FC<SidebarHeaderProps> = ({
  icon,
  title,
  secondary,
  actions,
  onClose,
}) => {
  return (
    <div className={styles.header}>
      <h3 className={styles.headerTitle}>
        {icon && <Icon name={icon} className={styles.headerIcon} />}
        {title}
      </h3>
      {secondary && <div className={styles.headerSecondary}>{secondary}</div>}

      {(actions || onClose) && (
        <div className={styles.headerActions}>
          {actions}
          {onClose && (
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label={title ? `Close ${title}` : "Close"}
              title={title ? `Close ${title}` : "Close"}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
