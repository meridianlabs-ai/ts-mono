import clsx from "clsx";
import { FC, ReactNode } from "react";

import { Icon, IconName } from "../icons";

import styles from "./Card.module.css";

interface CardHeaderProps {
  id?: string;
  icon?: IconName;
  label?: string;
  type?: "default" | "modern";
  className?: string;
  children?: ReactNode;
}

interface CardBodyProps {
  id?: string;
  children?: ReactNode;
  className?: string | string[];
  padded?: boolean;
}

interface CardProps {
  id?: string;
  children?: ReactNode;
  className?: string | string[];
}

export const CardHeader: FC<CardHeaderProps> = ({
  id,
  icon,
  type,
  label,
  className,
  children,
}) => {
  return (
    <div
      className={clsx(
        styles.headerContainer,
        "text-style-label",
        className,
        type === "modern" ? styles.headerModern : ""
      )}
      id={id || ""}
    >
      {icon ? (
        <Icon name={icon} className={styles.headerIcon} />
      ) : (
        <span
          className={clsx(styles.headerIcon, styles.headerIconEmpty)}
        ></span>
      )}
      {label ? label : ""} {children}
    </div>
  );
};

export const CardBody: FC<CardBodyProps> = ({
  id,
  children,
  className,
  padded = true,
}) => {
  return (
    <div
      className={clsx(
        styles.body,
        className,
        !padded ? styles.noPadding : undefined
      )}
      id={id || ""}
    >
      {children}
    </div>
  );
};

export const Card: FC<CardProps> = ({ id, children, className }) => {
  return (
    <div className={clsx(styles.card, className)} id={id}>
      {children}
    </div>
  );
};
