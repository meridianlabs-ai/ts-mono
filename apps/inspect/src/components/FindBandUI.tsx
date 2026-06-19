import clsx from "clsx";
import React, { FC, KeyboardEvent, RefObject, useRef } from "react";

import { Button } from "@tsmono/react/components";

import { ApplicationIcons } from "../app/appearance/icons";

import "./FindBand.css";

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
  noResults?: boolean;
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
  noResults = false,
  disableNav,
  inputRef: externalRef,
}) => {
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;

  // Build input props — only include `value` when controlled
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

  const hasCount = matchCount !== undefined && matchIndex !== undefined;
  const showStatus = noResults || (hasCount && matchCount > 0);
  const statusText =
    hasCount && matchCount > 0
      ? `${matchIndex + 1} of ${matchCount}`
      : "No results";

  return (
    <div data-unsearchable="true" className={clsx("findBand")}>
      <input ref={inputRef} {...inputProps} />
      <span
        className={clsx(
          "findBand-match-count",
          noResults && "findBand-no-results"
        )}
        style={{ visibility: showStatus ? "visible" : "hidden" }}
      >
        {statusText}
      </span>
      <Button
        title="Previous match"
        className="prev"
        onClick={onPrevious}
        disabled={disableNav}
      >
        <i className={ApplicationIcons.arrows.up} />
      </Button>
      <Button
        title="Next match"
        className="next"
        onClick={onNext}
        disabled={disableNav}
      >
        <i className={ApplicationIcons.arrows.down} />
      </Button>
      <Button title="Close" className="close" onClick={onClose}>
        <i className={ApplicationIcons.close} />
      </Button>
    </div>
  );
};
