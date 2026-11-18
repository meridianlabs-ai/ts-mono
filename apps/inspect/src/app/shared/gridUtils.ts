import type { RowData } from "@tanstack/react-table";

import type {
  ExtendedColumnDef,
  PickerColumn,
} from "@tsmono/inspect-components/dataGrid";

/**
 * The picker/view-state descriptor for each grid column that has an id.
 * The id keys both the visibility map and the grid column.
 */
export const toPickerColumns = <TRow extends RowData>(
  columns: ExtendedColumnDef<TRow>[]
): PickerColumn[] =>
  columns.flatMap((col) =>
    col.id === undefined
      ? []
      : [
          {
            id: col.id,
            label: typeof col.header === "string" ? col.header : "",
          },
        ]
  );
