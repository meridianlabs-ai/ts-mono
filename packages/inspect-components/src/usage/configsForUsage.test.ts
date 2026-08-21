import { describe, expect, it } from "vitest";

import { testEvalSpec, testModelConfig } from "@tsmono/inspect-common/testing";
import type { ModelConfig } from "@tsmono/inspect-common/types";

import {
  buildArgsByModel,
  buildArgsByRole,
  buildConfigsByModel,
  buildConfigsByRole,
} from "./configsForUsage";

const config = (
  model: string,
  cfg: ModelConfig["config"] = {},
  args: ModelConfig["args"] = {}
): ModelConfig => testModelConfig({ model, config: cfg, args });

describe("buildConfigsByRole", () => {
  it("keeps a single binding's config as-is", () => {
    const spec = testEvalSpec({
      model_roles: { grader: config("mockllm/model", { temperature: 0.5 }) },
    });
    expect(buildConfigsByRole(spec)).toEqual({ grader: { temperature: 0.5 } });
  });

  it("merges a list role's configs, later models overriding earlier", () => {
    const spec = testEvalSpec({
      model_roles: {
        grader: [
          config("mockllm/model_a", { temperature: 0, max_tokens: 100 }),
          config("mockllm/model_b", { temperature: 1 }),
        ],
      },
    });
    expect(buildConfigsByRole(spec)).toEqual({
      grader: { temperature: 1, max_tokens: 100 },
    });
  });

  it("never lets a later model's null/undefined clobber a defined value", () => {
    const spec = testEvalSpec({
      model_roles: {
        grader: [
          config("mockllm/model_a", { temperature: 0.7 }),
          config("mockllm/model_b", { temperature: null }),
        ],
      },
    });
    expect(buildConfigsByRole(spec)).toEqual({ grader: { temperature: 0.7 } });
  });
});

describe("buildConfigsByModel", () => {
  it("gives each model of a list role its own entry", () => {
    const spec = testEvalSpec({
      model_roles: {
        grader: [
          config("mockllm/model_a", { temperature: 0 }),
          config("mockllm/model_b", { temperature: 1 }),
        ],
      },
    });
    expect(buildConfigsByModel(spec)).toEqual({
      "mockllm/model_a": { temperature: 0 },
      "mockllm/model_b": { temperature: 1 },
    });
  });
});

describe("buildArgsByModel", () => {
  it("gives each model of a list role its own entry", () => {
    const spec = testEvalSpec({
      model_roles: {
        grader: [
          config("mockllm/model_a", {}, { seed: 1 }),
          config("mockllm/model_b", {}, { seed: 2 }),
        ],
      },
    });
    expect(buildArgsByModel(spec)).toEqual({
      "mockllm/model_a": { seed: 1 },
      "mockllm/model_b": { seed: 2 },
    });
  });
});

describe("buildArgsByRole", () => {
  it("merges a list role's args, later models overriding earlier", () => {
    const spec = testEvalSpec({
      model_roles: {
        grader: [
          config("mockllm/model_a", {}, { chain_of_thought: true, seed: 1 }),
          config("mockllm/model_b", {}, { seed: 2 }),
        ],
      },
    });
    expect(buildArgsByRole(spec)).toEqual({
      grader: { chain_of_thought: true, seed: 2 },
    });
  });
});
