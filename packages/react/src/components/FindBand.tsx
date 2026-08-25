import {
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { deepActiveElement, isEditableTarget } from "@tsmono/util";

import { useFindCoordinator, useFindState } from "../find";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";

import { scrollRangeToCenter } from "./findBandDom";
import { FindBandUI } from "./FindBandUI";
import { isFindNextShortcut, isFindShortcut } from "./findShortcuts";
import { useFindTargetSetter } from "./FindTargetContext";

const findConfig = {
  caseSensitive: false,
  wrapAround: false,
  wholeWord: false,
  searchInFrames: false,
  showDialog: false,
};

interface FindBandProps {
  onClose: () => void;
  // Type-ahead debounce. Defaults preserve each app's pre-unification value
  // (inspect 100ms; scout passes 300ms).
  debounceMs?: number;
}

/**
 * The find band: FindBandUI plus the keyboard grammar (Esc, Enter/Shift+
 * Enter, F3, Ctrl/Cmd+G, focus stealing), driving the find coordinator.
 * When a surface is registered for the active scope, everything — counts,
 * stepping, reveal — goes through the coordinator. When none is (Scoring/
 * Metadata/JSON tabs, until phase 2 gives them sources), a minimal legacy
 * window.find path steps through the rendered DOM with wrap.
 */
export const FindBand: FC<FindBandProps> = ({ onClose, debounceMs = 100 }) => {
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const coordinator = useFindCoordinator();
  const findState = useFindState();
  const setFindTarget = useFindTargetSetter();
  const needsCursorRestoreRef = useRef<boolean>(false);
  const focusTimeoutRef = useRef<number | null>(null);

  const hasSurface = findState.scopeId !== null;

  // Legacy-path state (deleted with the fallback in phase 2).
  const [legacyNoResults, setLegacyNoResults] = useState(false);
  const legacyTermRef = useRef<string>("");

  const handleSearch = useCallback(
    (back = false) => {
      const term = searchBoxRef.current?.value ?? "";
      if (!term) {
        coordinator.setTerm("");
        setLegacyNoResults(false);
        setFindTarget(null);
        return;
      }
      if (hasSurface) {
        if (term !== findState.term) {
          // Fresh term: publish it for auto-expand consumers, then survey.
          // The coordinator reveals the first match as results stream in.
          setFindTarget({ term, eventId: "" });
          coordinator.setTerm(term);
        } else if (back) {
          coordinator.previous();
        } else {
          coordinator.next();
        }
        return;
      }

      // ---- Legacy fallback: plain window.find stepping with wrap. Kept
      // ONLY for tabs without a registered surface (Scoring/Metadata/JSON);
      // phase 2 gives those sources and DELETES this path. ----
      const termChanged = legacyTermRef.current !== term;
      legacyTermRef.current = term;
      const focusedElement = document.activeElement;
      let found = windowFind(term, back);
      if (!found) {
        // Wrap: restart the scan from the document edge.
        window.getSelection()?.removeAllRanges();
        if (back) positionSelectionForWrap(back);
        found = windowFind(term, back);
      }
      setLegacyNoResults(!found);
      if (found) {
        if (termChanged) setFindTarget({ term, eventId: "" });
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          scrollRangeToCenter(selection.getRangeAt(0));
        }
      }
      if (focusedElement instanceof HTMLElement) focusedElement.focus();
    },
    [coordinator, findState.term, hasSurface, setFindTarget]
  );

  useEffect(() => {
    focusTimeoutRef.current = window.setTimeout(() => {
      searchBoxRef.current?.focus();
      searchBoxRef.current?.select();
    }, 10);

    const focusTimeout = focusTimeoutRef.current;

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (focusTimeout !== null) {
        window.clearTimeout(focusTimeout);
      }
      setFindTarget(null);
    };
  }, [setFindTarget]);

  // Closing the band resets the coordinator (clears highlights, aborts any
  // in-flight query).
  useEffect(() => () => coordinator.close(), [coordinator]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        handleSearch(e.shiftKey);
      } else if (isFindNextShortcut(e)) {
        e.preventDefault();
        handleSearch(e.shiftKey);
      } else if (isFindShortcut(e)) {
        searchBoxRef.current?.focus();
        searchBoxRef.current?.select();
      }
    },
    [onClose, handleSearch]
  );

  const findPrevious = useCallback(() => {
    handleSearch(true);
  }, [handleSearch]);

  const findNext = useCallback(() => {
    handleSearch(false);
  }, [handleSearch]);

  const restoreCursor = useCallback(() => {
    if (!needsCursorRestoreRef.current) return;
    needsCursorRestoreRef.current = false;
    const input = searchBoxRef.current;
    if (input) {
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }, []);

  const runDebouncedSearch = useCallback(() => {
    if (!searchBoxRef.current) return;
    handleSearch(false);
    // Mark for cursor restore on next keypress: the legacy path's
    // window.find steals the input selection (the coordinator path never
    // touches it, so the position-0 guard below simply never fires).
    needsCursorRestoreRef.current = true;
  }, [handleSearch]);

  const handleInputChange = useDebouncedCallback(
    runDebouncedSearch,
    debounceMs
  );

  const restoreCursorIfNeeded = useCallback(() => {
    const input = searchBoxRef.current;
    if (!input) return;
    // Only restore when the caret sits collapsed at position 0 — the
    // telltale of window.find() having stolen the selection. A caret the
    // user placed mid-text (or a selection they made) must stay put.
    if (
      input.selectionStart === 0 &&
      input.selectionEnd === 0 &&
      input.value.length > 0
    ) {
      restoreCursor();
    } else {
      needsCursorRestoreRef.current = false;
    }
  }, [restoreCursor]);

  const handleBeforeInput = useCallback(() => {
    restoreCursorIfNeeded();
  }, [restoreCursorIfNeeded]);

  // Consolidated global keyboard handler
  useEffect(() => {
    const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
      // F3: Find next/previous
      if (e.key === "F3") {
        e.preventDefault();
        handleSearch(e.shiftKey);
        return;
      }

      // Ctrl/Cmd+F: Focus search box (block browser find).
      if (isFindShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        searchBoxRef.current?.focus();
        searchBoxRef.current?.select();
        return;
      }

      // Ctrl/Cmd+G: Find next/previous
      if (isFindNextShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        handleSearch(e.shiftKey);
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key.length !== 1 && e.key !== "Backspace" && e.key !== "Delete")
        return;

      const input = searchBoxRef.current;
      if (!input) return;

      if (document.activeElement !== input) {
        // Don't steal focus from another editable surface — users typing
        // into a textarea/input/contenteditable should keep their keystrokes.
        if (isEditableTarget(deepActiveElement())) return;

        // Typing from outside the input appends, so an unconditional
        // restore-to-end is right here; a caret inside the focused input
        // gets the position-0 guard instead.
        restoreCursor();
        input.focus();
      } else {
        restoreCursorIfNeeded();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleGlobalKeyDown, true);
    };
  }, [handleSearch, restoreCursor, restoreCursorIfNeeded]);

  // Coordinator-driven count display: N of M, with "M+" when the total is a
  // lower bound (relation "gte", or interim totals while a survey streams).
  const total = findState.total;
  const matchCount =
    hasSurface && total !== null && total.value > 0 ? total.value : undefined;
  const matchIndex =
    matchCount !== undefined && findState.activeIndex !== null
      ? findState.activeIndex
      : undefined;
  const noResults = hasSurface ? findState.noResults : legacyNoResults;

  return (
    <FindBandUI
      inputRef={searchBoxRef}
      onClose={onClose}
      onNext={findNext}
      onPrevious={findPrevious}
      onKeyDown={handleKeyDown}
      onBeforeInput={handleBeforeInput}
      onChange={handleInputChange}
      noResults={noResults}
      matchCount={matchCount}
      matchIndex={matchIndex}
      countIsLowerBound={total?.relation === "gte"}
    />
  );
};
// `Window.find` is a non-standard but widely-supported API not in lib.dom.
// Typed optional so hosts without it degrade to "No results" on the legacy
// fallback path instead of throwing mid-search.
declare global {
  interface Window {
    find?(
      searchTerm?: string,
      caseSensitive?: boolean,
      backwards?: boolean,
      wrapAround?: boolean,
      wholeWord?: boolean,
      searchInFrames?: boolean,
      showDialog?: boolean
    ): boolean;
  }
}

function windowFind(searchTerm: string, back: boolean): boolean {
  return (
    window.find?.(
      searchTerm,
      findConfig.caseSensitive,
      back,
      findConfig.wrapAround,
      findConfig.wholeWord,
      findConfig.searchInFrames,
      findConfig.showDialog
    ) ?? false
  );
}

function positionSelectionForWrap(back: boolean): void {
  if (!back) return;
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(document.body);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
