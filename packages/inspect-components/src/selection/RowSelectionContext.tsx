import { createContext, FC, ReactNode } from "react";

/** Toggle for the whole list while selection mode is on (stable identity). */
export const RowToggleContext = createContext<
  ((id: string, extend: boolean) => void) | undefined
>(undefined);

/**
 * The id of the row being rendered, set only for selectable rows. A primitive
 * so scrolling doesn't re-render every row; a row view compares it to its own
 * id, so views nested inside a row (an inline approval panel, the messages of
 * a model event) don't get a checkbox too.
 */
export const RowIdContext = createContext<string | undefined>(undefined);

/** Whether the row being rendered is selected — a primitive, so a toggle
 *  re-renders only the rows whose value changed. */
export const RowSelectedContext = createContext<boolean>(false);

/** Provides one list row's id and selected flag to the views inside it. */
export const SelectableRow: FC<{
  id: string | undefined;
  selected: boolean;
  children: ReactNode;
}> = ({ id, selected, children }) => (
  <RowIdContext.Provider value={id}>
    <RowSelectedContext.Provider value={selected}>
      {children}
    </RowSelectedContext.Provider>
  </RowIdContext.Provider>
);
