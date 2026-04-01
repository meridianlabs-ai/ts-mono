import { forwardRef, useCallback } from "react";

import { ToolButton } from "@tsmono/react/components";

import { ApplicationIcons } from "../../../../components/icons";
import { useStore } from "../../../../state/store";

export const ScannerDataframeFilterColumnsButton = forwardRef<
  HTMLButtonElement,
  unknown
>((_, ref) => {
  const showFilter = useStore((state) => state.dataframeShowFilterColumns);
  const setShowFilter = useStore(
    (state) => state.setDataframeShowFilterColumns
  );

  const toggleShowFilter = useCallback(() => {
    setShowFilter(!showFilter);
  }, [showFilter, setShowFilter]);

  return (
    <ToolButton
      icon={ApplicationIcons.checkbox.checked}
      label="Choose Columns"
      onClick={toggleShowFilter}
      latched={showFilter}
      ref={ref}
      subtle={true}
    />
  );
});

ScannerDataframeFilterColumnsButton.displayName =
  "ScannerDataframeFilterColumnsButton";
