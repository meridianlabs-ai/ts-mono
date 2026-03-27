import clsx from "clsx";
import { FC } from "react";

import { useComponentIcons } from "./ComponentIconContext";
import styles from "./NoContentsPanel.module.css";

interface NoContentsPanelProps {
  text: string;
  icon?: string;
}

export const NoContentsPanel: FC<NoContentsPanelProps> = ({ text, icon }) => {
  const icons = useComponentIcons();

  return (
    <div className={clsx(styles.panel)}>
      <div className={clsx(styles.container, "text-size-smaller")}>
        <i className={icon ?? icons.noSamples} />
        <div>{text}</div>
      </div>
    </div>
  );
};
