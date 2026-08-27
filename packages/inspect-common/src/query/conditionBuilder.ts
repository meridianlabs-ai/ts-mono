import type {
  CompoundCondition,
  Condition,
  ConditionBase,
  ConditionModel,
  ConditionValue,
  LogicalOperatorModel,
  OperatorModel,
  SimpleCondition,
} from "./types";
import { isScalarArray, isTuple } from "./types";

const serializeValue = (
  value: Exclude<ConditionValue, Condition> | null
): ConditionModel["right"] => {
  if (value === null) return null;
  if (isScalarArray(value)) return value;
  if (isTuple(value)) return value;
  return value;
};

/**
 * Two builder classes rather than one taking `compound: boolean`: the
 * discriminated union is keyed on the literals `false` and `true`, and a
 * constructor parameter can only ever widen those to `boolean`. Each class
 * declares its own discriminant, so both halves of the union are satisfied
 * outright instead of asserted into place.
 */
abstract class ConditionBuilderBase implements ConditionBase {
  /** Each subclass returns `this`, which is already the union member it is. */
  protected abstract self(): Condition;

  and(other: Condition): Condition {
    return ConditionBuilder.compound("AND", this.self(), other);
  }

  or(other: Condition): Condition {
    return ConditionBuilder.compound("OR", this.self(), other);
  }

  not(): Condition {
    return ConditionBuilder.compound("NOT", this.self(), null);
  }

  abstract toJSON(): ConditionModel;
}

class SimpleConditionBuilder
  extends ConditionBuilderBase
  implements SimpleCondition
{
  readonly compound = false;

  constructor(
    readonly left: string,
    readonly operator: OperatorModel,
    readonly right: Exclude<ConditionValue, Condition> | null
  ) {
    super();
  }

  protected self(): Condition {
    return this;
  }

  toJSON(): ConditionModel {
    return {
      is_compound: false,
      left: this.left,
      operator: this.operator,
      right: serializeValue(this.right),
    };
  }
}

class CompoundConditionBuilder
  extends ConditionBuilderBase
  implements CompoundCondition
{
  readonly compound = true;

  constructor(
    readonly left: Condition,
    readonly operator: LogicalOperatorModel,
    readonly right: Condition | null
  ) {
    super();
  }

  protected self(): Condition {
    return this;
  }

  toJSON(): ConditionModel {
    return {
      is_compound: true,
      left: this.left.toJSON(),
      operator: this.operator,
      right: this.right ? this.right.toJSON() : null,
    };
  }
}

/** Factories for Condition instances. */
export const ConditionBuilder = {
  // Excludes Condition, matching SimpleCondition.right: a nested condition
  // belongs on the compound side, and serializeValue has no case for one.
  simple(
    field: string,
    operator: OperatorModel,
    value: Exclude<ConditionValue, Condition> | null
  ): SimpleCondition {
    return new SimpleConditionBuilder(field, operator, value);
  },

  compound(
    operator: LogicalOperatorModel,
    left: Condition,
    right: Condition | null = null
  ): CompoundCondition {
    return new CompoundConditionBuilder(left, operator, right);
  },
};
