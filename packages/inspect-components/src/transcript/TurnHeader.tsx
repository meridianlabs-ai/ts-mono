import clsx from "clsx";
import { FC, useCallback, useEffect, useState } from "react";

import styles from "./TurnHeader.module.css";

const kChevronUp = "bi bi-chevron-up";
const kChevronDown = "bi bi-chevron-down";
const kChevronLeft = "bi bi-chevron-left";
const kChevronRight = "bi bi-chevron-right";
const kOpenTabIcon = "bi bi-box-arrow-up-right";

interface TurnHeaderProps {
  turnNumber: number;
  totalTurns: number;
  onPrev: () => void;
  onNext: () => void;
  /** Jump to an arbitrary 1-based turn number (out-of-range is clamped). */
  onGoToTurn: (turnNumber: number) => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** When set, render an open-in-new-tab link to the single-event page. */
  focusUrl?: string;
  /** Sticky top offset in px (height of the chrome above, e.g. swimlanes). */
  offsetTop?: number;
  /** Agent-lane breadcrumb + prev/next (h/l) for pages without a swimlane (the
   *  focus page). On the main transcript the swimlane breadcrumb owns this, so
   *  it's left unset there. */
  agentLane?: {
    name: string;
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
  };
}

/**
 * Thin sticky turn-navigation strip: the current turn N/M plus prev/next
 * chevrons and an open-in-new-tab link. Purely navigation - the per-event
 * headers (with their tabs) stay as they are and sit above this strip.
 */
export const TurnHeader: FC<TurnHeaderProps> = ({
  turnNumber,
  totalTurns,
  onPrev,
  onNext,
  onGoToTurn,
  hasPrev,
  hasNext,
  focusUrl,
  offsetTop = 0,
  agentLane,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    setEditing(false);
    const n = parseInt(draft, 10);
    if (!Number.isNaN(n)) onGoToTurn(n);
  };

  const startEditing = useCallback(() => {
    setDraft(String(turnNumber));
    setEditing(true);
  }, [turnNumber]);

  // Ctrl/Cmd+G ("go to turn") opens the turn-number editor from the keyboard,
  // the same jump otherwise reached by clicking the number. Ignored while the
  // user is typing in a field; when the find band is open its own capture-phase
  // handler claims Ctrl+G (find-next) and stops it before this bubble listener.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "g") return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      startEditing();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [startEditing]);

  return (
    <div
      className={clsx("text-size-smaller", styles.turnHeader)}
      style={{ top: `${offsetTop}px` }}
    >
      <div className={styles.turnLabelOnTop}>
        {agentLane && (
          <span className={styles.agentLane}>
            <span className={styles.agentLaneName}>{agentLane.name}</span>
            <button
              type="button"
              className={styles.button}
              title="Previous agent (h)"
              aria-label="Previous agent"
              disabled={!agentLane.hasPrev}
              onClick={agentLane.onPrev}
            >
              <i className={kChevronLeft} />
            </button>
            <button
              type="button"
              className={styles.button}
              title="Next agent (l)"
              aria-label="Next agent"
              disabled={!agentLane.hasNext}
              onClick={agentLane.onNext}
            >
              <i className={kChevronRight} />
            </button>
            <span className={styles.agentLaneDivider} />
          </span>
        )}
        <span className={styles.label}>
          {"turn "}
          {editing ? (
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              className={styles.turnInput}
              style={{ width: `${String(totalTurns).length + 1}ch` }}
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              onBlur={() => setEditing(false)}
            />
          ) : (
            <button
              type="button"
              className={styles.editable}
              title="Edit turn number (Ctrl+G)"
              onClick={startEditing}
            >
              {turnNumber}
            </button>
          )}
          {`/${totalTurns}`}
        </span>
        <button
          type="button"
          className={styles.button}
          title="Next turn (j)"
          aria-label="Next turn"
          disabled={!hasNext}
          onClick={onNext}
        >
          <i className={kChevronDown} />
        </button>
        <button
          type="button"
          className={styles.button}
          title="Previous turn (k)"
          aria-label="Previous turn"
          disabled={!hasPrev}
          onClick={onPrev}
        >
          <i className={kChevronUp} />
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
