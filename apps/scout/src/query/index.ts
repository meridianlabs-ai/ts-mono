/**
 * Query builder for constructing filter conditions.
 *
 * The builder (`Column`, `ConditionBuilder`) and its types are shared with
 * inspect via `@tsmono/inspect-common/query`; scout adds transcript-specific
 * column definitions on top.
 *
 * @example
 * ```typescript
 * import { transcriptColumns } from "@/query";
 *
 * const filter = transcriptColumns.model.eq("gpt-4")
 *   .and(transcriptColumns.score.gt(0.8));
 * JSON.stringify({ filter }); // serializes via .toJSON()
 * ```
 *
 * @module query
 */

export { Column, ConditionBuilder } from "@tsmono/inspect-common/query";
export type {
  Condition,
  ConditionModel,
  ConditionValue,
  LogicalOperatorModel,
  OperatorModel,
  OrderByModel,
  ScalarValue,
} from "@tsmono/inspect-common/query";
export { isScalarArray, isTuple } from "@tsmono/inspect-common/query";

export { TranscriptColumns, transcriptColumns } from "./transcriptColumns";
