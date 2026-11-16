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

/**
 * Size constraints for a column.
 */
export interface ColumnSizeConstraints {
  /** Default size in pixels */
  size: number;
  /** Minimum allowed size in pixels */
  minSize: number;
  /** Maximum allowed size in pixels */
  maxSize: number;
}

/** Default minimum column size in pixels */
export const DEFAULT_MIN_SIZE = 40;

/** Default maximum column size in pixels */
export const DEFAULT_MAX_SIZE = 600;

/** Default column size in pixels when not specified */
export const DEFAULT_SIZE = 150;

/**
 * Clamp a size value to min/max constraints.
 */
export function clampSize(
  size: number,
  constraints: ColumnSizeConstraints
): number {
  return Math.max(constraints.minSize, Math.min(constraints.maxSize, size));
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

/**
 * Extract size constraints from column definitions.
 */
export function getColumnConstraints(
  columns: ColumnSizingDefinition[]
): Map<string, ColumnSizeConstraints> {
  const constraints = new Map<string, ColumnSizeConstraints>();

  for (const column of columns) {
    const id = getColumnId(column);
    if (id) {
      constraints.set(id, {
        size: column.size ?? DEFAULT_SIZE,
        minSize: column.minSize ?? DEFAULT_MIN_SIZE,
        maxSize: column.maxSize ?? DEFAULT_MAX_SIZE,
      });
    }
  }

  return constraints;
}
