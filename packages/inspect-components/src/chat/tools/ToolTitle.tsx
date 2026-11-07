import clsx from "clsx";
import { FC, Fragment } from "react";

import { ContentText } from "@tsmono/react/components";
import { Icon } from "@tsmono/react/icons";

import styles from "./ToolTitle.module.css";

interface ToolTitleProps {
  title: string;
  description?: string;
}

/**
 * Renders the ToolCallView component.
 */
export const ToolTitle: FC<ToolTitleProps> = ({ title, description }) => {
  return (
    <Fragment>
      <Icon name="tools" className={clsx(styles.image, "text-size-smaller")} />
      <code className={clsx("text-size-smaller", styles.toolTitle)}>
        <ContentText text={title} />
      </code>
      {description ? (
        <span className={clsx(styles.description, "text-size-smallest")}>
          - <ContentText text={description} />
        </span>
      ) : undefined}
    </Fragment>
  );
};
