import {
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  tableFeatures,
} from "@tanstack/react-table";

export const dataGridFeatures = tableFeatures({
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
});

export type DataGridFeatures = typeof dataGridFeatures;
