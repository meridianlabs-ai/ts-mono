import { describe, expect, it } from "vitest";

import { rolesForModel } from "./roleAliases";

describe("rolesForModel", () => {
  const aliases = {
    grader: "mockllm/model_a, mockllm/model_b",
    critic: "mockllm/model_a",
  };

  it("matches a single-model alias exactly", () => {
    expect(rolesForModel(aliases, "mockllm/model_a")).toEqual([
      "grader",
      "critic",
    ]);
  });

  it("matches each member of a list-role alias", () => {
    expect(rolesForModel(aliases, "mockllm/model_b")).toEqual(["grader"]);
  });

  it("returns no roles for an unbound model", () => {
    expect(rolesForModel(aliases, "mockllm/model_c")).toEqual([]);
    expect(rolesForModel(undefined, "mockllm/model_a")).toEqual([]);
  });
});
