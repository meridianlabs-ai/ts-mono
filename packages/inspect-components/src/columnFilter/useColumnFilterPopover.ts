import { useCallback, useState } from "react";

import type { FilterSpec, FilterType, UiOperator } from "./types";
import { useColumnFilter } from "./useColumnFilter";

export interface UseColumnFilterPopoverParams {
  columnId: string;
  filterType: FilterType;
  spec: FilterSpec | null;
  onChange: (spec: FilterSpec | null) => void;
  operators?: UiOperator[];
}

export interface UseColumnFilterPopoverReturn {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;

  operator: ReturnType<typeof useColumnFilter>["operator"];
  setOperator: ReturnType<typeof useColumnFilter>["setOperator"];
  operatorOptions: ReturnType<typeof useColumnFilter>["operatorOptions"];

  value: ReturnType<typeof useColumnFilter>["value"];
  setValue: ReturnType<typeof useColumnFilter>["setValue"];
  value2: ReturnType<typeof useColumnFilter>["value2"];
  setValue2: ReturnType<typeof useColumnFilter>["setValue2"];
  isValueDisabled: ReturnType<typeof useColumnFilter>["takesNoValue"];
  isRangeOperator: ReturnType<typeof useColumnFilter>["usesRangeValue"];

  commitAndClose: () => void;
  cancelAndClose: () => void;
}

export function useColumnFilterPopover({
  columnId,
  filterType,
  spec,
  onChange,
  operators,
}: UseColumnFilterPopoverParams): UseColumnFilterPopoverReturn {
  const [isOpen, setIsOpen] = useState(false);

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
    buildSpec,
  } = useColumnFilter({ columnId, filterType, spec, isOpen, operators });

  const cancelAndClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Apply (button / Enter) is the only commit point. Closing any other way —
  // click-outside, Escape — discards edits: useColumnFilter re-syncs the
  // editor from the applied spec when the popover is closed.
  const commitAndClose = useCallback(() => {
    const next = buildSpec();
    if (next === undefined) {
      return; // invalid input — keep the popover open
    }
    onChange(next);
    setIsOpen(false);
  }, [buildSpec, onChange]);

  return {
    isOpen,
    setIsOpen,
    operator,
    setOperator,
    value,
    setValue,
    value2,
    setValue2,
    operatorOptions,
    isValueDisabled,
    isRangeOperator,
    commitAndClose,
    cancelAndClose,
  };
}
