import clsx from "clsx";
import { FC } from "react";

import { PopOver } from "@tsmono/react/components";

import { useTranscriptFilter } from "./hooks";
import styles from "./TranscriptFilter.module.css";

export interface TranscriptFilterProps {
  showing: boolean;
  setShowing: (showing: boolean) => void;
  positionEl: HTMLElement | null;
}

export const TranscriptFilterPopover: FC<TranscriptFilterProps> = ({
  showing,
  positionEl,
  setShowing,
}) => {
  const {
    isDefaultFilter,
    isDebugFilter,
    isNoneFilter,
    setDefaultFilter,
    setDebugFilter,
    setNoneFilter,
    filterEventType,
    eventTypes,
    filtered,
    arrangedEventTypes,
  } = useTranscriptFilter();

  return (
    <PopOver
      id={`transcript-filter-popover`}
      positionEl={positionEl}
      isOpen={showing}
      setIsOpen={setShowing}
      placement="bottom-end"
      hoverDelay={-1}
    >
      <div className={clsx(styles.links, "text-size-smaller")}>
        <button
          type="button"
          className={clsx(isDefaultFilter ? styles.selected : undefined)}
          onClick={() => setDefaultFilter()}
        >
          Default
        </button>
        |
        <button
          type="button"
          className={clsx(isDebugFilter ? styles.selected : undefined)}
          onClick={() => setDebugFilter()}
        >
          Debug
        </button>
        |
        <button
          type="button"
          className={clsx(isNoneFilter ? styles.selected : undefined)}
          onClick={() => setNoneFilter()}
        >
          None
        </button>
      </div>

      <div className={clsx(styles.grid, "text-size-smaller")}>
        {arrangedEventTypes(2).map((eventType) => {
          return (
            <label key={eventType} className={clsx(styles.row)}>
              <input
                type="checkbox"
                checked={!filtered.includes(eventType)}
                onChange={(e) => {
                  filterEventType(eventType, e.target.checked);
                }}
              />
              {eventTypes[eventType]}
            </label>
          );
        })}
      </div>
    </PopOver>
  );
};
