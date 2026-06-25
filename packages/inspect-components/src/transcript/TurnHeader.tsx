import clsx from "clsx";
import { FC } from "react";

import styles from "./TurnHeader.module.css";

const kChevronUp = "bi bi-chevron-up";
const kChevronDown = "bi bi-chevron-down";
const kOpenTabIcon = "bi bi-box-arrow-up-right";

interface TurnHeaderProps {
  turnNumber: number;
  totalTurns: number;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** When set, render an open-in-new-tab link to the single-event page. */
  focusUrl?: string;
  /** Sticky top offset in px (height of the chrome above, e.g. swimlanes). */
  offsetTop?: number;
}

/**
 * Thin sticky turn-navigation strip: the current turn N/M plus prev/next
 * chevrons and an open-in-new-tab link. Purely navigation — the per-event
 * headers (with their tabs) stay as they are and sit above this strip.
 */
export const TurnHeader: FC<TurnHeaderProps> = ({
  turnNumber,
  totalTurns,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  focusUrl,
  offsetTop = 0,
}) => {
  return (
    <div
      className={clsx("text-size-smaller", styles.turnHeader)}
      style={{ top: `${offsetTop}px` }}
    >
      <div className={styles.turnLabelOnTop}>
        <span
          className={styles.label}
        >{`turn ${turnNumber}/${totalTurns}`}</span>
        <button
          type="button"
          className={styles.button}
          title="Previous turn (j)"
          aria-label="Previous turn"
          disabled={!hasPrev}
          onClick={onPrev}
        >
          <i className={kChevronUp} />
        </button>
        <button
          type="button"
          className={styles.button}
          title="Next turn (k)"
          aria-label="Next turn"
          disabled={!hasNext}
          onClick={onNext}
        >
          <i className={kChevronDown} />
        </button>
        {focusUrl ? (
          <a
            className={styles.button}
            href={focusUrl}
            target="_blank"
            rel="noreferrer"
            title="Open turn in new tab"
            aria-label="Open turn in new tab"
          >
            <i className={kOpenTabIcon} />
          </a>
        ) : null}
      </div>
    </div>
  );
};
