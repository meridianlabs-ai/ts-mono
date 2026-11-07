import clsx from "clsx";
import { FC } from "react";

import { Icon, IconName } from "../icons";

import styles from "./NoContentsPanel.module.css";

interface NoContentsPanelProps {
  text: string;
  icon?: IconName;
  /** In-progress state: drop the icon and animate a trailing ellipsis. */
  busy?: boolean;
}

export const NoContentsPanel: FC<NoContentsPanelProps> = ({
  text,
  icon,
  busy,
}) => {
  return (
    <div className={clsx(styles.panel)}>
      <div className={clsx(styles.container, "text-size-smaller")}>
        {!busy && <Icon name={icon ?? "noSamples"} />}
        <div>
          {text}
          {busy && (
            <span className={clsx(styles.ellipsis)} aria-hidden="true">
              <i>.</i>
              <i>.</i>
              <i>.</i>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
