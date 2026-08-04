import { completedAtFallback } from "../../../../log_data";

import { LogListRow } from "./types";

/** The Completed column's cell/sort value over a shaped row — the same
 *  fallback rule the data layer's column schema applies to records (see
 *  `completedAtFallback` for the rationale). */
export const completedAtValue = (row: LogListRow): string | undefined =>
  completedAtFallback(row.completedAt, row.name);
