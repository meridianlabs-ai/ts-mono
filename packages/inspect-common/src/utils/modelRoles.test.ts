import { describe, expect, it } from "vitest";

import type { ModelConfig } from "../types";

import {
  modelRoleConfigs,
  modelRoleModelNames,
  modelRoleNames,
  splitModelRoleNames,
} from "./modelRoles";

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

describe("modelRoleNames", () => {
  it("maps each role to its display names", () => {
    expect(
      modelRoleNames({
        grader: [config("mockllm/model_a"), config("mockllm/model_b")],
        critic: config("mockllm/model"),
      })
    ).toEqual({
      grader: "mockllm/model_a, mockllm/model_b",
      critic: "mockllm/model",
    });
  });

  it("drops roles without a model name", () => {
    expect(
      modelRoleNames({ grader: config(""), critic: config("mockllm/model") })
    ).toEqual({ critic: "mockllm/model" });
  });

  it("returns undefined when nothing remains", () => {
    expect(modelRoleNames(undefined)).toBeUndefined();
    expect(modelRoleNames({})).toBeUndefined();
    expect(modelRoleNames({ grader: config("") })).toBeUndefined();
  });
});

describe("splitModelRoleNames", () => {
  it("round-trips a display string back to individual model names", () => {
    const list = [config("mockllm/model_a"), config("mockllm/model_b")];
    expect(splitModelRoleNames(modelRoleModelNames(list))).toEqual([
      "mockllm/model_a",
      "mockllm/model_b",
    ]);
    expect(splitModelRoleNames("mockllm/model")).toEqual(["mockllm/model"]);
  });

  it("tolerates the no-space join used by inspect_ai's Python surfaces", () => {
    expect(splitModelRoleNames("mockllm/model_a,mockllm/model_b")).toEqual([
      "mockllm/model_a",
      "mockllm/model_b",
    ]);
  });
});
