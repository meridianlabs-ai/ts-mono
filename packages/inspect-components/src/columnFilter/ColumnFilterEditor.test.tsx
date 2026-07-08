// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ConditionEditorProps } from "./ColumnFilterEditor";
import { ColumnFilterEditor } from "./ColumnFilterEditor";
import { OPERATORS_BY_TYPE } from "./operators";

const noop = () => {};

const condition = (
  overrides: Partial<ConditionEditorProps> = {}
): ConditionEditorProps => ({
  operator: "contains",
  onOperatorChange: noop,
  value: "",
  onValueChange: noop,
  value2: "",
  onValue2Change: noop,
  isValueDisabled: false,
  isRangeOperator: false,
  ...overrides,
});

describe("ColumnFilterEditor", () => {
  afterEach(() => cleanup());

  it("renders word labels for operator options (values stay tokens)", () => {
    const { container } = render(
      <ColumnFilterEditor
        columnId="task"
        filterType="number"
        operatorOptions={OPERATORS_BY_TYPE.string}
        condition={condition()}
      />
    );
    const option = container.querySelector<HTMLOptionElement>(
      '#task-op option[value="contains"]'
    );
    expect(option).not.toBeNull();
    expect(option!.textContent).toBe("Contains");
  });

  it("renders the join radiogroup and second condition row when second is set", () => {
    const { container } = render(
      <ColumnFilterEditor
        columnId="task"
        filterType="number"
        operatorOptions={OPERATORS_BY_TYPE.number}
        condition={condition({ operator: "=", value: "1" })}
        second={condition({ operator: "=" })}
        join="or"
      />
    );
    const group = container.querySelector('[role="radiogroup"]');
    expect(group).not.toBeNull();
    expect(group!.getAttribute("aria-label")).toBe("Join conditions");
    const orRadio = container.querySelector<HTMLInputElement>(
      'input[name="task-join"][value="or"]'
    );
    expect(orRadio).not.toBeNull();
    expect(orRadio!.checked).toBe(true);
    expect(container.querySelector("#task-op-b")).not.toBeNull();
    expect(container.querySelector("#task-val-b")).not.toBeNull();
  });

  it("omits the second condition row when second is undefined", () => {
    const { container } = render(
      <ColumnFilterEditor
        columnId="task"
        filterType="number"
        operatorOptions={OPERATORS_BY_TYPE.number}
        condition={condition({ operator: "=" })}
      />
    );
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector("#task-op-b")).toBeNull();
  });
});
