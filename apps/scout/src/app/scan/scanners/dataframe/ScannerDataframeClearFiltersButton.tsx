import { FC, useCallback } from "react";

import { ToolButton } from "@tsmono/react/components";

import { ApplicationIcons } from "../../../../icons";
import {
  emptyDataframeState,
  GRID_STATE_NAME,
} from "../../../../state/dataframeState";
import { useStore } from "../../../../state/store";

export const ScannerDataframeClearFiltersButton: FC = () => {
  const setGridState = useStore((state) => state.setGridState);
  const gridState = useStore((state) => state.gridStates[GRID_STATE_NAME]);

  const clearState = useCallback(() => {
    setGridState(GRID_STATE_NAME, {
      ...(gridState ?? emptyDataframeState),
      columnFilters: {},
    });
  }, [gridState, setGridState]);

  return (
    <ToolButton
      icon={ApplicationIcons.filter}
      label="Clear Filters"
      onClick={clearState}
      subtle={true}
    />
  );
};
