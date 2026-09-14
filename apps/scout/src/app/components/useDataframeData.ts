import type { ColumnTable } from "arquero";

import { GRID_STATE_NAME } from "../../state/dataframeState";
import { useStore } from "../../state/store";
import { defaultColumns } from "../scan/scanners/types";
import { rowRecords } from "../utils/arrowCells";

import { matchesDataframeFilter, type DataframeRow } from "./dataframeModel";

export interface DataframeData {
  allRows: DataframeRow[];
  rows: DataframeRow[];
  columnNames: string[];
}

const preferredColumns = ["transcript_id", "value", "explanation", "metadata"];

export function useDataframeData(columnTable?: ColumnTable): DataframeData {
  const chosenColumns = useStore((state) => state.dataframeFilterColumns);
  const filters = useStore(
    (state) => state.gridStates[GRID_STATE_NAME]?.columnFilters
  );
  const available = columnTable?.columnNames() ?? [];
  const rank = (name: string) => {
    const index = preferredColumns.indexOf(name);
    return index < 0 ? preferredColumns.length : index;
  };
  const columnNames = (chosenColumns ?? defaultColumns)
    .filter((name) => available.includes(name))
    .sort((a, b) => rank(a) - rank(b));
  const allRows = columnTable ? rowRecords(columnTable) : [];
  const activeFilters = Object.entries(filters ?? {}).filter(([id]) =>
    available.includes(id)
  );
  const rows = activeFilters.length
    ? allRows.filter((row) =>
        activeFilters.every(([id, filter]) =>
          matchesDataframeFilter(row[id], filter)
        )
      )
    : allRows;
  return { allRows, rows, columnNames };
}
