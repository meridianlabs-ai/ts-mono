import type { ColumnFilterEditorProps } from "./ColumnFilterEditor";
import type { UseColumnFilterPopoverReturn } from "./useColumnFilterPopover";

type EditorPopoverState = Pick<
  UseColumnFilterPopoverReturn,
  | "operator"
  | "setOperator"
  | "value"
  | "setValue"
  | "value2"
  | "setValue2"
  | "isValueDisabled"
  | "isRangeOperator"
  | "join"
  | "setJoin"
  | "secondOperator"
  | "setSecondOperator"
  | "secondValue"
  | "setSecondValue"
  | "secondValue2"
  | "setSecondValue2"
  | "showSecond"
  | "secondUsesValue"
  | "secondUsesRangeValue"
>;

/**
 * Map filter-popover state to `ColumnFilterEditor`'s `condition`/`second`/
 * `join` props, so the editor's call sites don't each hand-wire the ~20
 * fields (and drift apart as the editor grows).
 */
export function editorConditionProps(
  state: EditorPopoverState
): Pick<
  ColumnFilterEditorProps,
  "condition" | "second" | "join" | "onJoinChange"
> {
  return {
    condition: {
      operator: state.operator,
      onOperatorChange: state.setOperator,
      value: state.value,
      onValueChange: state.setValue,
      value2: state.value2,
      onValue2Change: state.setValue2,
      isValueDisabled: state.isValueDisabled,
      isRangeOperator: state.isRangeOperator,
    },
    second: state.showSecond
      ? {
          operator: state.secondOperator,
          onOperatorChange: state.setSecondOperator,
          value: state.secondValue,
          onValueChange: state.setSecondValue,
          value2: state.secondValue2,
          onValue2Change: state.setSecondValue2,
          isValueDisabled: !state.secondUsesValue,
          isRangeOperator: state.secondUsesRangeValue,
        }
      : undefined,
    join: state.join,
    onJoinChange: state.setJoin,
  };
}
