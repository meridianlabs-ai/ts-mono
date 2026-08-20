import { clsx } from "clsx";
import { FC, useRef } from "react";

import {
  ColumnFilterEditor,
  editorConditionProps,
} from "@tsmono/inspect-components/columnFilter";
import { PopOver } from "@tsmono/react/components";

import { ScalarValue } from "../../api/api";
import { ApplicationIcons } from "../../icons";

import { Chip } from "./Chip";
import type { useAddFilterPopover } from "./columnFilter";
import styles from "./FilterBar.module.css";

export type AddFilterPopoverState = ReturnType<typeof useAddFilterPopover>;

export interface AddFilterButtonProps {
  /** Unique prefix for popover IDs */
  idPrefix: string;
  /** Popover state from useAddFilterPopover hook */
  popoverState: AddFilterPopoverState;
  /** Suggestions for autocomplete */
  suggestions?: ScalarValue[];
}

/** "Add filter" chip plus Scout's column picker and the shared filter editor. */
export const AddFilterButton: FC<AddFilterButtonProps> = ({
  idPrefix,
  popoverState,
  suggestions = [],
}) => {
  const chipRef = useRef<HTMLDivElement | null>(null);

  const {
    isOpen,
    setIsOpen,
    selectedColumnId,
    columns,
    filterType,
    operatorOptions,
    handleColumnChange,
    commitAndClose,
    cancelAndClose,
  } = popoverState;

  return (
    <>
      <Chip
        ref={chipRef}
        icon={ApplicationIcons.add}
        value="Add"
        title="Add a new filter"
        className={clsx(styles.filterChip, "text-size-smallest")}
        onClick={() => setIsOpen(true)}
      />
      <PopOver
        id={`${idPrefix}-add-filter-editor`}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        // eslint-disable-next-line react-hooks/refs -- positionEl accepts null; PopOver/Popper handles this in effects and updates when ref is populated
        positionEl={chipRef.current}
        placement="bottom-start"
        showArrow={true}
        hoverDelay={-1}
        closeOnMouseLeave={false}
        styles={{
          padding: "0.4rem",
          backgroundColor: "var(--bs-light)",
        }}
      >
        <select
          id={`${idPrefix}-column-select`}
          className={styles.addFilterColumnSelect}
          value={selectedColumnId ?? ""}
          onChange={(event) => handleColumnChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              cancelAndClose();
            }
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the popover was explicitly opened by the user
          autoFocus
        >
          <option value="">Select column...</option>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.label}
            </option>
          ))}
        </select>
        {selectedColumnId && (
          <ColumnFilterEditor
            columnId={selectedColumnId}
            filterType={filterType}
            operatorOptions={operatorOptions}
            {...editorConditionProps(popoverState)}
            onCommit={commitAndClose}
            onCancel={cancelAndClose}
            suggestions={suggestions}
          />
        )}
      </PopOver>
    </>
  );
};
