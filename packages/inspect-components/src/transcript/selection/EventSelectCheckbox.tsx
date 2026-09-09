import clsx from "clsx";
import { FC, useContext } from "react";

import { TranscriptIcons } from "../icons";

import {
  EventRowIdContext,
  EventRowSelectedContext,
  TranscriptRowToggleContext,
} from "./EventRowSelectionContext";
import styles from "./EventSelectCheckbox.module.css";

export interface EventRowSelection {
  id: string;
  selected: boolean;
  onToggle: (id: string, extend: boolean) => void;
}

/** The row's selection when selection mode is on and this card IS the row. */
export const useEventRowSelection = (
  eventNodeId: string | undefined
): EventRowSelection | undefined => {
  const onToggle = useContext(TranscriptRowToggleContext);
  const rowId = useContext(EventRowIdContext);
  const selected = useContext(EventRowSelectedContext);
  return onToggle && rowId !== undefined && rowId === eventNodeId
    ? { id: rowId, selected, onToggle }
    : undefined;
};

/**
 * Header checkbox for evidence selection. Shift-click extends the selection
 * from the last toggled row.
 */
export const EventSelectCheckbox: FC<{ selection: EventRowSelection }> = ({
  selection,
}) => {
  const { id, selected, onToggle } = selection;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? "Deselect event" : "Select event"}
      title={selected ? "Deselect event" : "Select event"}
      className={clsx(styles.selectBox, selected && styles.selectBoxChecked)}
      // A shift-click must not start a text selection across the card.
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(id, e.shiftKey);
      }}
    >
      {selected ? <i className={TranscriptIcons.selection.checked} /> : null}
    </button>
  );
};
