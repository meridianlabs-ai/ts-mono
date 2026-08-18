import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type FC,
  type KeyboardEvent,
} from "react";

import { FindBandUI } from "./FindBandUI";
import { useFindController, useFindSnapshot } from "./FindContext";
import { isFindNextShortcut, isFindShortcut } from "./findShortcuts";

interface FindBarProps {
  onClose: () => void;
}

/** The find-in-page band. Mounting activates the controller (sources start
 *  indexing); unmounting is the close teardown. */
export const FindBar: FC<FindBarProps> = ({ onClose }) => {
  const controller = useFindController();
  const snapshot = useFindSnapshot();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    controller.setActive(true);
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => controller.setActive(false);
  }, [controller]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => controller.setTerm(e.target.value),
    [controller]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" || isFindNextShortcut(e)) {
        e.preventDefault();
        controller.step(e.shiftKey ? -1 : 1);
        // Firefox's window.find moves focus to the found content — take it
        // back so the next Enter still reaches this input (the fallback's
        // stepping anchor lives in the controller, not the selection, so
        // refocusing loses nothing).
        inputRef.current?.focus();
      }
    },
    [controller, onClose]
  );

  // Global stepping/refocus while the band is open (input may not have focus).
  useEffect(() => {
    const onGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      if (isFindNextShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        controller.step(e.shiftKey ? -1 : 1);
      } else if (isFindShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onGlobalKeyDown, true);
    return () => document.removeEventListener("keydown", onGlobalKeyDown, true);
  }, [controller]);

  const stepAndRefocus = useCallback(
    (direction: 1 | -1) => {
      controller.step(direction);
      inputRef.current?.focus();
    },
    [controller]
  );

  const { term, query, total, ordinal, indexing, hasSources, fallbackNoMatch } =
    snapshot;
  const statusText = !query
    ? undefined
    : indexing
      ? // Progressive: matches in the already-extracted prefix have final
        // ordinals, so the landed match shows its number while counting.
        ordinal > 0
        ? `${ordinal} of Counting…`
        : "Counting…"
      : !hasSources
        ? // Sourceless fallback (window.find) has no counts: the moving
          // selection/highlight is the indicator; only a miss says anything.
          fallbackNoMatch
          ? "No results"
          : undefined
        : total > 0
          ? `${ordinal > 0 ? ordinal : 1} of ${total}`
          : "No results";

  const noResults =
    !!query && !indexing && (hasSources ? total === 0 : fallbackNoMatch);

  return (
    <FindBandUI
      inputRef={inputRef}
      value={term}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlurAway={controller.flushFallbackTerm}
      onClose={onClose}
      onNext={() => stepAndRefocus(1)}
      onPrevious={() => stepAndRefocus(-1)}
      statusText={statusText}
      noResults={noResults}
    />
  );
};
