import clsx from "clsx";
import { FC, ReactNode } from "react";

import { Icon, IconName } from "../icons";

import styles from "./NonIdealState.module.css";

interface NonIdealStateProps {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export const NonIdealState: FC<NonIdealStateProps> = ({
  icon,
  title,
  description,
  action,
  className,
}) => {
  return (
    <div className={clsx(styles.container, className)}>
      {icon && <Icon name={icon} className={styles.icon} />}
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.description}>{description}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
};
