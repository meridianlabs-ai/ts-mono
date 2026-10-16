import clsx from "clsx";
import { FC, ReactNode } from "react";

import { Icon, IconName } from "@tsmono/react/icons";

import {
  EventSelectCheckbox,
  useEventRowSelection,
} from "../selection/EventSelectCheckbox";

import styles from "./EventRow.module.css";

interface EventRowProps {
  /** The row's node id; enables the evidence-selection checkbox. */
  eventNodeId?: string;
  title: ReactNode;
  icon: IconName;
  iconClassName?: string;
  className?: string;
  children?: ReactNode | ReactNode[];
  /** Optional full-width content rendered below the title row, inside the card. */
  below?: ReactNode;
}
/**
 * Renders the EventRow component.
 */
export const EventRow: FC<EventRowProps> = ({
  eventNodeId,
  title,
  icon,
  iconClassName,
  className,
  children,
  below,
}) => {
  const rowSelection = useEventRowSelection(eventNodeId);
  const contentEl = title ? (
    <>
      <div
        className={clsx(
          "text-size-small",
          styles.title,
          rowSelection && styles.selectable,
          className
        )}
      >
        {rowSelection ? <EventSelectCheckbox selection={rowSelection} /> : null}
        <Icon name={icon} className={iconClassName} />
        <div className={clsx("text-style-label")}>{title}</div>
        <div>{children}</div>
      </div>
      {below ? (
        <div className={clsx("text-size-small", styles.below)}>{below}</div>
      ) : null}
    </>
  ) : (
    ""
  );

  return (
    <div
      className={clsx(
        "card",
        styles.contents,
        rowSelection?.selected && styles.selected
      )}
    >
      {contentEl}
    </div>
  );
};
