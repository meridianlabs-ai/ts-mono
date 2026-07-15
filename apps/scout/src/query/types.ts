/**
 * Query types shared with inspect via `@tsmono/inspect-common/query`.
 *
 * The query builder (`Column`, `ConditionBuilder`) and its types live in
 * `inspect-common` so scout and inspect stay in sync. This module re-exports
 * them and asserts, at compile time, that scout's generated OpenAPI schema
 * still matches the shared hand-written types — if the scout server's query
 * contract drifts, the assertions below fail to compile.
 */
import type {
  ConditionModel,
  LogicalOperatorModel,
  OperatorModel,
  OrderByModel,
} from "@tsmono/inspect-common/query";

import type { components } from "../types/generated";

export type {
  OperatorModel,
  LogicalOperatorModel,
  ConditionModel,
  OrderByModel,
  ScalarValue,
  ConditionValue,
  Condition,
  SimpleCondition,
  CompoundCondition,
  ConditionBase,
} from "@tsmono/inspect-common/query";
export {
  isSimpleCondition,
  isCompoundCondition,
  isScalarArray,
  isTuple,
} from "@tsmono/inspect-common/query";

// Compile-time tripwire: each shared type must stay bidirectionally assignable
// with scout's generated schema. `AssertExact` resolves to `false` on any
// mismatch, so assigning `true` to that slot below fails to compile.
type AssertExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

export const __assertQuerySchemaCompat: [
  AssertExact<OperatorModel, components["schemas"]["Operator"]>,
  AssertExact<LogicalOperatorModel, components["schemas"]["LogicalOperator"]>,
  AssertExact<ConditionModel, components["schemas"]["Condition"]>,
  AssertExact<OrderByModel, components["schemas"]["OrderBy"]>,
] = [true, true, true, true];
