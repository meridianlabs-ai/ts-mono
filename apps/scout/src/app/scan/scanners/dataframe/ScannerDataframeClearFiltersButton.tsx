import { FC } from "react";

import { ToolButton } from "@tsmono/react/components";

import { ApplicationIcons } from "../../../../icons";
import { GRID_STATE_NAME } from "../../../../state/dataframeState";
import { useStore } from "../../../../state/store";

export const ScannerDataframeClearFiltersButton: FC = () => {
  const setGridState = useStore((state) => state.setGridState);

  const clearState = (): void => {
    setGridState(GRID_STATE_NAME, (previous) => ({
      ...previous,
      columnFilters: {},
    }));
  };

  return (
    <ToolButton
      icon={ApplicationIcons.filter}
      label="Clear Filters"
      onClick={clearState}
      subtle={true}
    />
  );
};
