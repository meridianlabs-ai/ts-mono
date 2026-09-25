import clsx from "clsx";
import { FC, useContext } from "react";

import { TranscriptIcons } from "../../transcript/icons";

import {
  MessageRowIdContext,
  MessageRowSelectedContext,
  MessageRowToggleContext,
} from "./MessageRowSelectionContext";
import styles from "./MessageSelectCheckbox.module.css";

export interface MessageRowSelection {
  id: string;
  selected: boolean;
  onToggle: (id: string, extend: boolean) => void;
}

/** The row's selection when selection mode is on and this row is selectable. */
export const useMessageRowSelection = (
  messageId: string | undefined
): MessageRowSelection | undefined => {
  const onToggle = useContext(MessageRowToggleContext);
  const rowId = useContext(MessageRowIdContext);
  const selected = useContext(MessageRowSelectedContext);
  return onToggle && rowId !== undefined && rowId === messageId
    ? { id: rowId, selected, onToggle }
    : undefined;
};

/**
 * Header checkbox for message evidence selection. Shift-click extends the
 * selection from the last toggled row.
 */
export const MessageSelectCheckbox: FC<{ selection: MessageRowSelection }> = ({
  selection,
}) => {
  const { id, selected, onToggle } = selection;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={selected ? "Deselect message" : "Select message"}
      title={selected ? "Deselect message" : "Select message"}
      className={clsx(styles.selectBox, selected && styles.selectBoxChecked)}
      // A shift-click must not start a text selection across the row.
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
