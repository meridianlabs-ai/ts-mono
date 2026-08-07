import clsx from "clsx";
import React, {
  ChangeEvent,
  FC,
  FocusEvent,
  KeyboardEvent,
  RefObject,
  useRef,
} from "react";

import { useComponentIcons } from "../components/ComponentIconContext";

import "./FindBand.css";

interface FindBandUIProps {
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  /** Fires only when focus leaves the band entirely — focus moving to the
   *  band's own buttons is not a blur (they act on the input's state). */
  onBlurAway?: () => void;
  value?: string;
  /** Explicit status line; overrides the matchCount/matchIndex display. */
  statusText?: string;
  matchCount?: number;
  matchIndex?: number;
  noResults?: boolean;
  disableNav?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}

/** Presentational find band: input, status, prev/next/close. Shared by the
 *  find-in-page bar and the log-list grid's own search band. */
export const FindBandUI: FC<FindBandUIProps> = ({
  onClose,
  onNext,
  onPrevious,
  onKeyDown,
  onChange,
  onBlurAway,
  value,
  statusText,
  matchCount,
  matchIndex,
  noResults = false,
  disableNav,
  inputRef: externalRef,
}) => {
  const icons = useComponentIcons();
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;

  const handleBlur = onBlurAway
    ? (e: FocusEvent<HTMLInputElement>) => {
        if (
          e.relatedTarget instanceof Element &&
          e.relatedTarget.closest(".findBand")
        ) {
          return;
        }
        onBlurAway();
      }
    : undefined;

  const inputProps: React.InputHTMLAttributes<HTMLInputElement> = {
    type: "text",
    placeholder: "Find",
    onKeyDown,
    onChange,
    onBlur: handleBlur,
  };
  if (value !== undefined) {
    inputProps.value = value;
  }

  const hasCount = matchCount !== undefined && matchIndex !== undefined;
  const derivedStatus = noResults
    ? "No results"
    : hasCount && matchCount > 0
      ? `${matchIndex + 1} of ${matchCount}`
      : undefined;
  const status = statusText ?? derivedStatus;

  return (
    <div data-find-ignore="true" className={clsx("findBand")}>
      <input ref={inputRef} {...inputProps} />
      <span
        className={clsx(
          "findBand-match-count",
          noResults && "findBand-no-results"
        )}
        style={{ visibility: status ? "visible" : "hidden" }}
      >
        {status}
      </span>
      {/* preventDefault on mousedown: the buttons must not take focus — the
          input keeps it (no blur, no refocus), so the document selection that
          anchors the sourceless fallback's stepping survives the click. */}
      <button
        type="button"
        title="Previous match"
        className="btn prev"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPrevious}
        disabled={disableNav}
      >
        <i className={icons.arrowUp} />
      </button>
      <button
        type="button"
        title="Next match"
        className="btn next"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNext}
        disabled={disableNav}
      >
        <i className={icons.arrowDown} />
      </button>
      <button
        type="button"
        title="Close"
        className="btn close"
        onClick={onClose}
      >
        <i className={icons.close} />
      </button>
    </div>
  );
};
