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

// Shared query builder, types, and guards.
export * from "@tsmono/inspect-common/query";

// Scout-specific transcript column definitions.
export { TranscriptColumns, transcriptColumns } from "./transcriptColumns";
