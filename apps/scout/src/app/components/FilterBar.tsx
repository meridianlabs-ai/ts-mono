import { clsx } from "clsx";
import { FC, useCallback, useRef, useState } from "react";

import {
  ColumnFilterEditor,
  editorConditionProps,
  isColumnFilter,
  NO_VALUE_OPERATORS,
  OPERATOR_LABELS,
  RANGE_VALUE_OPERATORS,
  useColumnFilterPopover,
  type FilterCondition,
  type FilterSpec,
} from "@tsmono/inspect-components/columnFilter";
import { PopOver, ToolDropdownButton } from "@tsmono/react/components";

import { ScalarValue } from "../../api/api";
import { ApplicationIcons } from "../../icons";
import type { ColumnFilter } from "../../state/store";

import { AddFilterButton, type AddFilterPopoverState } from "./AddFilterButton";
import { Chip } from "./Chip";
import { ChipGroup } from "./ChipGroup";
import type { AvailableColumn } from "./columnFilter";
import { ColumnPickerButton } from "./ColumnPickerButton";
import { ColumnsPopover, type ColumnInfo } from "./ColumnsPopover";
import styles from "./FilterBar.module.css";

const kCopyCodeDescriptors = [
  { label: "Code (Python)", value: "python" },
  { label: "Filter (SQL)", value: "filter" },
];

export interface FilterBarProps {
  /** Current column filters */
  filters: Record<string, ColumnFilter>;
  /** Callback when a filter spec is changed */
  onFilterChange: (columnId: string, spec: FilterSpec | null) => void;
  /** Callback when a filter is removed */
  onRemoveFilter: (columnId: string) => void;
  /** Optional code representations for copy functionality */
  filterCodeValues?: Record<string, string>;
  /** Autocomplete suggestions for filter values */
  filterSuggestions?: ScalarValue[];
  /** Callback when filter column selection changes (for fetching suggestions) */
  onFilterColumnChange?: (columnId: string | null) => void;
  /** Unique ID prefix for popovers */
  popoverIdPrefix?: string;

  // Add filter button config
  /** Popover state from useAddFilterPopover hook */
  addFilterPopoverState: AddFilterPopoverState;

  // Column picker config (optional - omit to hide)
  /** Column definitions for the picker */
  columns?: ColumnInfo[];
  /** Currently visible column IDs */
  visibleColumns?: string[];
  /** Default visible column IDs */
  defaultVisibleColumns?: string[];
  /** Callback when visible columns change */
  onVisibleColumnsChange?: (columns: string[]) => void;
}

export const FilterBar: FC<FilterBarProps> = ({
  filters,
  onFilterChange,
  onRemoveFilter,
  filterCodeValues,
  filterSuggestions = [],
  onFilterColumnChange,
  popoverIdPrefix = "filter",
  addFilterPopoverState,
  columns,
  visibleColumns,
  defaultVisibleColumns,
  onVisibleColumnsChange,
}) => {
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const chipRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const editingFilter = editingColumnId ? filters[editingColumnId] : null;

  const handleFilterChange = useCallback(
    (spec: FilterSpec | null) => {
      if (!editingColumnId) return;
      onFilterChange(editingColumnId, spec);
    },
    [editingColumnId, onFilterChange]
  );

  const popover = useColumnFilterPopover({
    columnId: editingColumnId ?? "",
    filterType: editingFilter?.filterType ?? "string",
    spec: editingFilter?.spec ?? null,
    onChange: handleFilterChange,
  });
  const {
    isOpen: isEditorOpen,
    setIsOpen: setIsEditorOpen,
    operatorOptions,
    commitAndClose,
    cancelAndClose,
  } = popover;

  const editFilter = useCallback(
    (columnId: string) => () => {
      setEditingColumnId(columnId);
      setIsEditorOpen(true);
      onFilterColumnChange?.(columnId);
    },
    [setIsEditorOpen, onFilterColumnChange]
  );

  const handleEditorOpenChange = useCallback(
    (open: boolean) => {
      setIsEditorOpen(open);
      if (!open) {
        onFilterColumnChange?.(null);
      }
    },
    [setIsEditorOpen, onFilterColumnChange]
  );

  return (
    <div className={styles.container}>
      <div
        className={clsx(
          "text-style-label",
          "text-style-secondary",
          "text-size-smallest",
          styles.filterLabel
        )}
      >
        Filter:
      </div>
      <ChipGroup className={styles.filterBar}>
        {/* isColumnFilter drops entries persisted by pre-FilterSpec builds */}
        {Object.values(filters)
          .filter(isColumnFilter)
          .map((filter) => (
            <Chip
              key={filter.columnId}
              ref={(element) => {
                chipRefs.current[filter.columnId] = element;
              }}
              label={filter.columnId}
              value={formatFilterSpec(filter.spec)}
              title={`Edit ${filter.columnId} filter`}
              closeTitle="Remove filter"
              className={clsx(styles.filterChip, "text-size-smallest")}
              onClose={() => onRemoveFilter(filter.columnId)}
              onClick={editFilter(filter.columnId)}
            />
          ))}
        <AddFilterButton
          idPrefix={popoverIdPrefix}
          popoverState={addFilterPopoverState}
          suggestions={filterSuggestions}
        />
      </ChipGroup>

      {editingColumnId && editingFilter && (
        <PopOver
          id={`${popoverIdPrefix}-editor-${editingColumnId}`}
          isOpen={isEditorOpen}
          setIsOpen={handleEditorOpenChange}
          // eslint-disable-next-line react-hooks/refs -- positionEl accepts null; PopOver/Popper handles this in effects and updates when ref is populated
          positionEl={chipRefs.current[editingColumnId] ?? null}
          placement="bottom-start"
          showArrow={true}
          hoverDelay={-1}
          closeOnMouseLeave={false}
          styles={{
            padding: "0.4rem",
            backgroundColor: "var(--bs-light)",
          }}
        >
          <ColumnFilterEditor
            columnId={editingColumnId}
            filterType={editingFilter.filterType}
            operatorOptions={operatorOptions}
            {...editorConditionProps(popover)}
            onCommit={commitAndClose}
            onCancel={cancelAndClose}
            suggestions={filterSuggestions}
          />
        </PopOver>
      )}

      <div className={clsx(styles.actionButtons)}>
        {filterCodeValues !== undefined && (
          <CopyQueryButton itemValues={filterCodeValues} />
        )}
        {columns && onVisibleColumnsChange && (
          <>
            <div className={styles.sep}></div>
            <ColumnPickerButton>
              {({ positionEl, isOpen, setIsOpen }) => (
                <ColumnsPopover
                  positionEl={positionEl}
                  isOpen={isOpen}
                  setIsOpen={setIsOpen}
                  columns={columns}
                  visibleColumns={visibleColumns ?? defaultVisibleColumns ?? []}
                  defaultVisibleColumns={defaultVisibleColumns ?? []}
                  onVisibleColumnsChange={onVisibleColumnsChange}
                  popoverId={`${popoverIdPrefix}-columns`}
                />
              )}
            </ColumnPickerButton>
          </>
        )}
      </div>
    </div>
  );
};

const CopyQueryButton: FC<{ itemValues?: Record<string, string> }> = ({
  itemValues,
}) => {
  const [icon, setIcon] = useState<string>(ApplicationIcons.copy);

  const items = kCopyCodeDescriptors.reduce(
    (acc, desc) => {
      acc[desc.label] = () => {
        const text = itemValues ? itemValues[desc.value] : "";
        if (!text) {
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        navigator.clipboard.writeText(text);
        setIcon(ApplicationIcons.confirm);
        setTimeout(() => {
          setIcon(ApplicationIcons.copy);
        }, 1250);
      };
      return acc;
    },
    {} as Record<string, () => void>
  );

  return (
    <ToolDropdownButton
      key="query-copy"
      label="Copy"
      icon={icon}
      title="Copy Filter"
      className={clsx(styles.actionButton, styles.chipButton)}
      disabled={Object.keys(itemValues || []).length === 0}
      dropdownAlign="right"
      dropdownClassName={"text-size-smallest"}
      items={items}
    />
  );
};

const formatFilterCondition = (condition: FilterCondition): string => {
  const label = OPERATOR_LABELS[condition.operator];
  if (NO_VALUE_OPERATORS.has(condition.operator)) {
    return label;
  }
  if (RANGE_VALUE_OPERATORS.has(condition.operator)) {
    return `${label} ${condition.value} to ${condition.value2 ?? ""}`;
  }
  return `${label} ${condition.value}`;
};

const formatFilterSpec = (spec: FilterSpec): string => {
  const primary = formatFilterCondition(spec);
  if (!spec.join || !spec.second) {
    return primary;
  }
  return `${primary} ${spec.join.toUpperCase()} ${formatFilterCondition(spec.second)}`;
};

export type { AddFilterPopoverState, AvailableColumn, ColumnInfo };
