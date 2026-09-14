import { describe, expect, it } from "vitest";

import { normalizeEvalSpec } from "@tsmono/inspect-common/normalize";
import { testEvalSpec, testModelConfig } from "@tsmono/inspect-common/testing";

import { kModelNone } from "../constants";

import { formatModelText, formatModelTitle } from "./evalModel";

describe("formatModelText", () => {
  it("formats single-model roles", () => {
    const spec = testEvalSpec({
      model: kModelNone,
      model_roles: {
        grader: testModelConfig({ model: "mockllm/model_a" }),
        critic: testModelConfig({ model: "mockllm/model_b" }),
      },
    });
    expect(formatModelText(spec)).toBe(
      "grader: mockllm/model_a; critic: mockllm/model_b"
    );
  });

  it("separates roles with ';' so list-valued roles stay unambiguous", () => {
    const spec = testEvalSpec({
      model: kModelNone,
      model_roles: {
        grader: [
          testModelConfig({ model: "mockllm/model_a" }),
          testModelConfig({ model: "mockllm/model_b" }),
        ],
        critic: testModelConfig({ model: "mockllm/model_c" }),
      },
    });
    expect(formatModelText(spec)).toBe(
      "grader: mockllm/model_a, mockllm/model_b; critic: mockllm/model_c"
    );
  });

  it("keeps the primary model before custom roles", () => {
    const spec = testEvalSpec({
      model: "openai/gpt-6",
      model_roles: {
        grader: [
          testModelConfig({ model: "mockllm/model_a" }),
          testModelConfig({ model: "mockllm/model_b" }),
        ],
        critic: testModelConfig({ model: "mockllm/model_c" }),
      },
    });
    expect(formatModelText(spec)).toBe(
      "openai/gpt-6; grader: mockllm/model_a, mockllm/model_b; critic: mockllm/model_c"
    );
  });

  it.each([undefined, null, {}])(
    "shows eval.model without roles (%j)",
    (roles) => {
      expect(
        formatModelText(
          testEvalSpec({ model: "mockllm/model", model_roles: roles })
        )
      ).toBe("mockllm/model");
    }
  );

  it("returns no model text before the eval is loaded", () => {
    expect(formatModelText()).toBe(undefined);
  });

  it("ignores the none/none placeholder", () => {
    expect(formatModelText(testEvalSpec({ model: kModelNone }))).toBe(
      undefined
    );
  });
});

describe("formatModelTitle", () => {
  it("keeps the primary model outside parenthesized roles", () => {
    const spec = testEvalSpec({
      model: "openai/gpt-6",
      model_roles: {
        grader: [
          testModelConfig({ model: "mockllm/model_a" }),
          testModelConfig({ model: "mockllm/model_b" }),
        ],
        critic: testModelConfig({ model: "mockllm/model_c" }),
      },
    });
    expect(formatModelTitle(spec)).toBe(
      "openai/gpt-6 (grader: mockllm/model_a, mockllm/model_b; critic: mockllm/model_c)"
    );
  });

  it.each([undefined, null, {}])(
    "shows the primary model without parentheses when roles are empty (%j)",
    (roles) => {
      expect(
        formatModelTitle(
          testEvalSpec({ model: "mockllm/model", model_roles: roles })
        )
      ).toBe("mockllm/model");
    }
  );

  it("shows only parenthesized roles for the none/none placeholder", () => {
    expect(
      formatModelTitle(
        testEvalSpec({
          model: kModelNone,
          model_roles: {
            grader: testModelConfig({ model: "mockllm/model_a" }),
          },
        })
      )
    ).toBe("(grader: mockllm/model_a)");
  });

  it("returns no title without a displayable model or roles", () => {
    expect(formatModelTitle()).toBeUndefined();
    expect(
      formatModelTitle(testEvalSpec({ model: kModelNone }))
    ).toBeUndefined();
    expect(formatModelTitle(normalizeEvalSpec({}))).toBeUndefined();
  });
});

it("formats roles when a legacy log omits the primary model", () => {
  const spec = normalizeEvalSpec({
    model_roles: {
      grader: testModelConfig({ model: "mockllm/model_a" }),
    },
  });
  expect(formatModelText(spec)).toBe("grader: mockllm/model_a");
  expect(formatModelTitle(spec)).toBe("(grader: mockllm/model_a)");
});
