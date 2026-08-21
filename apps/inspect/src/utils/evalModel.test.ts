import { describe, expect, it } from "vitest";

import { testEvalSpec, testModelConfig } from "@tsmono/inspect-common/testing";

import { kModelNone } from "../constants";
import { formatModelText } from "./evalModel";

describe("formatModelText", () => {
  it("formats single-model roles", () => {
    const spec = testEvalSpec({
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

  it("falls back to eval.model when no roles are set", () => {
    expect(formatModelText(testEvalSpec({ model: "mockllm/model" }))).toBe(
      "mockllm/model"
    );
  });

  it("ignores the none/none placeholder", () => {
    expect(formatModelText(testEvalSpec({ model: kModelNone }))).toBe(
      undefined
    );
  });
});
