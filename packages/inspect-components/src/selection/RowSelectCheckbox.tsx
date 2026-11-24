import clsx from "clsx";
import { FC, useContext } from "react";

import { Icon } from "@tsmono/react/icons";

import styles from "./RowSelectCheckbox.module.css";
import type { SelectableItem } from "./rowSelection";
import {
  RowIdContext,
  RowSelectedContext,
  RowToggleContext,
} from "./RowSelectionContext";

export interface SelectableRowState {
  id: string;
  selected: boolean;
  onToggle: (id: string, extend: boolean) => void;
}

/** The row's selection when selection mode is on and this view IS the row. */
export const useSelectableRow = (
  rowId: string | undefined
): SelectableRowState | undefined => {
  const onToggle = useContext(RowToggleContext);
  const contextId = useContext(RowIdContext);
  const selected = useContext(RowSelectedContext);
  return onToggle && contextId !== undefined && contextId === rowId
    ? { id: contextId, selected, onToggle }
    : undefined;
};

/**
 * Header checkbox for evidence selection. Shift-click extends the selection
 * from the last toggled row.
 */
export const RowSelectCheckbox: FC<{
  selection: SelectableRowState;
  item: SelectableItem;
}> = ({ selection, item }) => {
  const { id, selected, onToggle } = selection;
  const label = `${selected ? "Deselect" : "Select"} ${item}`;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      title={label}
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
      {selected ? <Icon name="selectionChecked" /> : null}
    </button>
  );
};
