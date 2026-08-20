import { describe, expect, it } from "vitest";

import type { ModelConfig } from "../types";

import { modelRoleConfigs, modelRoleModelNames } from "./modelRoles";

const config = (model: string): ModelConfig => ({
  model,
  args: {},
  config: {},
});

describe("modelRoleConfigs", () => {
  it("wraps a single binding in a list", () => {
    const single = config("mockllm/model");
    expect(modelRoleConfigs(single)).toEqual([single]);
  });

  it("returns a list binding as-is", () => {
    const list = [config("mockllm/model_a"), config("mockllm/model_b")];
    expect(modelRoleConfigs(list)).toEqual(list);
  });
});

describe("modelRoleModelNames", () => {
  it("returns the model name for a single binding", () => {
    expect(modelRoleModelNames(config("mockllm/model"))).toBe("mockllm/model");
  });

  it("comma-separates the names of a list binding", () => {
    expect(
      modelRoleModelNames([
        config("mockllm/model_a"),
        config("mockllm/model_b"),
      ])
    ).toBe("mockllm/model_a, mockllm/model_b");
  });
});
