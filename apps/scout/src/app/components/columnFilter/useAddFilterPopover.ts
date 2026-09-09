import { useCallback, useState } from "react";

import {
  useColumnFilter,
  type ColumnFilter,
  type FilterType,
} from "@tsmono/inspect-components/columnFilter";

export interface AvailableColumn {
  id: string;
  label: string;
  filterType: FilterType;
}

export interface UseAddFilterPopoverParams {
  /** Columns available for filtering */
  columns: AvailableColumn[];
  /** Current filters */
  filters: Record<string, ColumnFilter>;
  /** Callback when a filter is added */
  onAddFilter: (filter: ColumnFilter) => void;
  /** Callback when the selected column changes (for fetching suggestions) */
  onFilterColumnChange?: (columnId: string | null) => void;
}

/** Scout's column-picker wrapper around the shared filter editor state. */
export function useAddFilterPopover({
  columns,
  filters,
  onAddFilter,
  onFilterColumnChange,
}: UseAddFilterPopoverParams) {
  const [isOpen, setOpenState] = useState(false);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);

  const selectedColumn = selectedColumnId
    ? columns.find((column) => column.id === selectedColumnId)
    : null;
  const filterType = selectedColumn?.filterType ?? "string";
  const existingFilter = selectedColumnId ? filters[selectedColumnId] : null;

  const {
    operator,
    setOperator,
    value,
    setValue,
    value2,
    setValue2,
    operatorOptions,
    takesNoValue: isValueDisabled,
    usesRangeValue: isRangeOperator,
    join,
    setJoin,
    secondOperator,
    setSecondOperator,
    secondValue,
    setSecondValue,
    secondValue2,
    setSecondValue2,
    showSecond,
    secondUsesValue,
    secondUsesRangeValue,
    buildSpec,
  } = useColumnFilter({
    columnId: selectedColumnId ?? "",
    filterType,
    spec: existingFilter?.spec ?? null,
    isOpen,
  });

  const setIsOpen = useCallback(
    (open: boolean) => {
      setOpenState(open);
      if (open) {
        setSelectedColumnId(null);
      } else {
        onFilterColumnChange?.(null);
      }
    },
    [onFilterColumnChange]
  );

  const handleColumnChange = useCallback(
    (newColumnId: string) => {
      setSelectedColumnId(newColumnId || null);
      onFilterColumnChange?.(newColumnId || null);
    },
    [onFilterColumnChange]
  );

  const commitAndClose = useCallback(() => {
    if (!selectedColumnId) return;
    const spec = buildSpec();
    if (spec === undefined) return; // invalid input — keep the popover open
    if (spec === null) {
      setIsOpen(false); // empty value — nothing to add
      return;
    }

    onAddFilter({ columnId: selectedColumnId, filterType, spec });
    setIsOpen(false);
  }, [selectedColumnId, buildSpec, onAddFilter, filterType, setIsOpen]);

  const cancelAndClose = useCallback(() => setIsOpen(false), [setIsOpen]);

  return {
    isOpen,
    setIsOpen,
    selectedColumnId,
    columns,
    filterType,
    operator,
    setOperator,
    operatorOptions,
    value,
    setValue,
    value2,
    setValue2,
    isValueDisabled,
    isRangeOperator,
    join,
    setJoin,
    secondOperator,
    setSecondOperator,
    secondValue,
    setSecondValue,
    secondValue2,
    setSecondValue2,
    showSecond,
    secondUsesValue,
    secondUsesRangeValue,
    handleColumnChange,
    commitAndClose,
    cancelAndClose,
  };
}
