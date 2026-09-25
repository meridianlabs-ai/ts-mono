import { createContext } from "react";

/** Toggle for the whole list while selection mode is on (stable identity). */
export const MessageRowToggleContext = createContext<
  ((id: string, extend: boolean) => void) | undefined
>(undefined);

/**
 * The id of the row being rendered, set only for selectable rows while
 * selection mode is on. A primitive so scrolling doesn't re-render every
 * row; `ChatMessageRow` compares it to its own message id.
 */
export const MessageRowIdContext = createContext<string | undefined>(undefined);

/** Whether the row being rendered is selected — a primitive, so a toggle
 *  re-renders only the rows whose value changed. */
export const MessageRowSelectedContext = createContext<boolean>(false);
