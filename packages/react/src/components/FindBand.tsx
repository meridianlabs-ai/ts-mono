import { FC, KeyboardEvent, useRef, useState } from "react";

import { deepActiveElement, isEditableTarget } from "@tsmono/util";

import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { useEventListener } from "../hooks/useEventListener";
import { useMountEffect } from "../hooks/useMountEffect";

import { FindDirection, useExtendedFind } from "./ExtendedFindContext";
import { FindBandUI } from "./FindBandUI";
import { FindSession, FindStatus } from "./findSession";
import { isFindNextShortcut, isFindShortcut } from "./findShortcuts";
import { useFindTargetSetter } from "./FindTargetContext";

interface FindBandProps {
  onClose: () => void;
  // Type-ahead debounce. Defaults preserve each app's pre-unification value
  // (inspect 100ms; scout passes 300ms).
  debounceMs?: number;
}

export const FindBand: FC<FindBandProps> = ({ onClose, debounceMs = 100 }) => {
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const { getFindSources, subscribeFindSources } = useExtendedFind();
  const setFindTarget = useFindTargetSetter();
  const sessionRef = useRef<FindSession | null>(null);
  const [status, setStatus] = useState<FindStatus | null>(null);

  useMountEffect(() => {
    const session = new FindSession({
      root: document.body,
      sources: getFindSources,
      band: () => bandRef.current,
      onStatus: setStatus,
    });
    sessionRef.current = session;
    const unsubscribe = subscribeFindSources(() => session.refresh());
    const focusTimeout = window.setTimeout(() => {
      searchBoxRef.current?.focus();
      searchBoxRef.current?.select();
    }, 10);
    return () => {
      window.clearTimeout(focusTimeout);
      unsubscribe();
      session.dispose();
      sessionRef.current = null;
      setFindTarget(null);
    };
  });

  // Returns whether the term changed.
  const applyTerm = (): boolean => {
    const session = sessionRef.current;
    const value = searchBoxRef.current?.value ?? "";
    if (!session || value === session.searchTerm) return false;
    // Before the session searches, so panels holding a match start
    // expanding before it scrolls to one.
    setFindTarget(value ? { term: value } : null);
    session.setTerm(value);
    return true;
  };

  const search = (direction: FindDirection): void => {
    // A term not yet searched (debounce pending) lands on its first match
    // from the viewport; searching backward steps once more, onto the match
    // before it.
    if (!applyTerm() || direction === "backward") {
      sessionRef.current?.step(direction);
    }
  };

  const handleInputChange = useDebouncedCallback(() => {
    applyTerm();
  }, debounceMs);

  const focusInput = () => {
    const input = searchBoxRef.current;
    if (!input) return;
    input.focus();
    input.select();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter") {
      search(e.shiftKey ? "backward" : "forward");
    } else if (isFindNextShortcut(e)) {
      e.preventDefault();
      search(e.shiftKey ? "backward" : "forward");
    } else if (isFindShortcut(e)) {
      focusInput();
    }
  };

  useEventListener(
    document,
    "keydown",
    (e) => {
      if (e.key === "F3") {
        e.preventDefault();
        search(e.shiftKey ? "backward" : "forward");
        return;
      }

      // Ctrl/Cmd+F: focus the search box instead of the browser's find.
      if (isFindShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        focusInput();
        return;
      }

      if (isFindNextShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        search(e.shiftKey ? "backward" : "forward");
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 && e.key !== "Backspace" && e.key !== "Delete")
        return;

      // Typing elsewhere on the page goes to the search box, appended to the
      // term, unless another editable surface owns the keystroke.
      const input = searchBoxRef.current;
      if (!input || document.activeElement === input) return;
      if (isEditableTarget(deepActiveElement())) return;
      const end = input.value.length;
      input.setSelectionRange(end, end);
      input.focus();
    },
    { capture: true }
  );

  const total = status?.total ?? 0;
  return (
    <FindBandUI
      ref={bandRef}
      inputRef={searchBoxRef}
      onClose={onClose}
      onNext={() => search("forward")}
      onPrevious={() => search("backward")}
      onKeyDown={handleKeyDown}
      onChange={handleInputChange}
      noResults={status !== null && status.term !== "" && total === 0}
      matchCount={total > 0 ? total : undefined}
      matchIndex={total > 0 ? (status?.ordinal ?? undefined) : undefined}
    />
  );
};
