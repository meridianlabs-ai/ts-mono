import clsx from "clsx";
import React, { FC, KeyboardEvent, RefObject, useRef } from "react";

import { useComponentIcons } from "./ComponentIconContext";
import styles from "./FindBandUI.module.css";

interface FindBandUIProps {
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onChange?: () => void;
  onBeforeInput?: () => void;
  value?: string;
  matchCount?: number;
  matchIndex?: number;
  /** The count is a lower bound (source relation "gte"): renders "M+". */
  countIsLowerBound?: boolean;
  noResults?: boolean;
  /** The last search failed; shown until the next search. */
  error?: string;
  disableNav?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export const FindBandUI: FC<FindBandUIProps> = ({
  onClose,
  onNext,
  onPrevious,
  onKeyDown,
  onChange,
  onBeforeInput,
  value,
  matchCount,
  matchIndex,
  countIsLowerBound = false,
  noResults = false,
  error,
  disableNav,
  inputRef: externalRef,
}) => {
  const icons = useComponentIcons();
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;

  const inputProps: React.InputHTMLAttributes<HTMLInputElement> = {
    type: "text",
    placeholder: "Find",
    onKeyDown,
    onBeforeInput,
    onChange,
  };
  if (value !== undefined) {
    inputProps.value = value;
  }

  const hasCount = matchCount !== undefined && matchCount > 0;
  const showStatus = noResults || hasCount || error !== undefined;
  // noResults wins over the counter: a registered source can report
  // matches that the DOM find can't reach (unsearchable or unrendered
  // content), which would otherwise display as "0 of N". An unknown
  // ordinal (backward wrap under a lower-bound total) shows the total alone.
  const total = hasCount
    ? `${matchCount.toLocaleString()}${countIsLowerBound ? "+" : ""}`
    : "";
  const statusText = noResults
    ? "No results"
    : error !== undefined && !hasCount
      ? "Error"
      : matchIndex === undefined
        ? total
        : `${(matchIndex + 1).toLocaleString()} of ${total}`;

  // "findBand" (unhashed) is a deliberate public hook for embedders whose CSS
  // targets the band (e.g. hawk's full-height exclusion). The viewer styles it
  // via the hashed styles.findBand, so this global class carries no rule.
  return (
    <div data-unsearchable="true" className={clsx(styles.findBand, "findBand")}>
      <input ref={inputRef} {...inputProps} />
      <span
        data-testid="find-band-match-count"
        className={clsx(
          styles.matchCount,
          (noResults || (error !== undefined && !hasCount)) && styles.noResults
        )}
        style={{ visibility: showStatus ? "visible" : "hidden" }}
      >
        {statusText}
      </span>
      <button
        type="button"
        title="Previous match"
        data-testid="find-band-prev"
        className={clsx("btn", styles.prev)}
        onClick={onPrevious}
        disabled={disableNav}
      >
        <i className={icons.arrowUp} />
      </button>
      <button
        type="button"
        title="Next match"
        data-testid="find-band-next"
        className={clsx("btn", styles.next)}
        onClick={onNext}
        disabled={disableNav}
      >
        <i className={icons.arrowDown} />
      </button>
      <button
        type="button"
        title="Close"
        className={clsx("btn", styles.close)}
        onClick={onClose}
      >
        <i className={icons.close} />
      </button>
      {error !== undefined ? (
        <div
          data-testid="find-band-error"
          className={styles.error}
          title={error}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
};
