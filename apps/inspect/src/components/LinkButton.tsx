import clsx from "clsx";
import { FC } from "react";

import { Icon, IconName } from "@tsmono/react/icons";

import styles from "./LinkButton.module.css";

interface LinkButtonProps {
  id?: string;
  text?: string;
  icon?: IconName;
  onClick: () => void;
  className?: string | string[];
}

/**
 * LightboxCarousel component provides a carousel with lightbox functionality.
 */
export const LinkButton: FC<LinkButtonProps> = ({
  id,
  text,
  icon,
  className,
  onClick,
}) => {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className={clsx(className, styles.button, "text-size-smaller")}
    >
      {icon ? <Icon name={icon} /> : undefined}
      {text ? <div className={clsx(styles.label)}>{text}</div> : undefined}
    </button>
  );
};
