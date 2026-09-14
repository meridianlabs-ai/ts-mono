import { createContext } from "react";

/** Toggle for the whole list while selection mode is on (stable identity). */
export const TranscriptRowToggleContext = createContext<
  ((id: string, extend: boolean) => void) | undefined
>(undefined);

/**
 * The id of the row being rendered, set only for selectable rows. A primitive
 * so scrolling doesn't re-render every card; `EventPanel`/`EventRow` compare
 * it to their own id, so panels nested inside a row (e.g. an inline approval)
 * don't get a checkbox too.
 */
export const EventRowIdContext = createContext<string | undefined>(undefined);

/** Whether the row being rendered is selected — a primitive, so a toggle
 *  re-renders only the rows whose value changed. */
export const EventRowSelectedContext = createContext<boolean>(false);
