import type {
  ConditionModel,
  LogicalOperatorModel,
  OperatorModel,
  OrderByModel,
} from "@tsmono/inspect-common/query";

import type { components } from "../types/generated";

type AssertExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

type Assert<T extends true> = T;

export type QuerySchemaCompatibility = [
  Assert<AssertExact<OperatorModel, components["schemas"]["Operator"]>>,
  Assert<
    AssertExact<LogicalOperatorModel, components["schemas"]["LogicalOperator"]>
  >,
  Assert<AssertExact<ConditionModel, components["schemas"]["Condition"]>>,
  Assert<AssertExact<OrderByModel, components["schemas"]["OrderBy"]>>,
];
