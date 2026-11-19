/**
 * Column sizing types and helpers for the dataframe grid.
 */

/** Column metadata needed for sizing, independent of a table's feature set. */
export interface ColumnSizingDefinition {
  id?: string;
  accessorKey?: unknown;
  header?: unknown;
  size?: number;
  minSize?: number;
  maxSize?: number;
  textValue?: (value: unknown) => string | null;
}

/** Default minimum column size in pixels */
export const DEFAULT_MIN_SIZE = 40;

/** Default maximum column size in pixels */
export const DEFAULT_MAX_SIZE = 600;

/** Default column size in pixels when not specified */
export const DEFAULT_SIZE = 150;

/**
 * Clamp a size to a column's min/max, using the defaults where unset.
 */
export function clampSize(
  size: number,
  column: Pick<ColumnSizingDefinition, "minSize" | "maxSize">
): number {
  const minSize = column.minSize ?? DEFAULT_MIN_SIZE;
  const maxSize = column.maxSize ?? DEFAULT_MAX_SIZE;
  return Math.max(minSize, Math.min(maxSize, size));
}

/**
 * Get the column ID from a column definition.
 */
export function getColumnId(column: ColumnSizingDefinition): string {
  return column.id || columnAccessorKey(column) || "";
}

/**
 * `accessorKey` is carried by only one member of TanStack's ColumnDef union,
 * so reading it off the union takes a check rather than a claim.
 */
export function columnAccessorKey(
  column: ColumnSizingDefinition
): string | undefined {
  return "accessorKey" in column && typeof column.accessorKey === "string"
    ? column.accessorKey
    : undefined;
}
