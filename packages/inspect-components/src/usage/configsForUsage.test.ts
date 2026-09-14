import { afterEach, describe, expect, it } from "vitest";

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

// Model names, role names and model_args keys come straight from the log
// header. A name that is an Object.prototype member must become an ordinary
// entry, never a write onto Object.prototype or the Object constructor.
describe("prototype safety", () => {
  const prototypeKeys = new Set(Object.getOwnPropertyNames(Object.prototype));
  const objectStatics = new Set(Object.getOwnPropertyNames(Object));
  const objectKeys = Object.keys;

  afterEach(() => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      if (!prototypeKeys.has(key))
        Reflect.deleteProperty(Object.prototype, key);
    }
    for (const key of Object.getOwnPropertyNames(Object)) {
      if (!objectStatics.has(key)) Reflect.deleteProperty(Object, key);
    }
    Object.keys = objectKeys;
  });

  it("keeps a __proto__ model's args and config off Object.prototype", () => {
    const spec = testEvalSpec({
      model: "__proto__",
      model_args: { planted_args: 1 },
      model_generate_config: { temperature: 0.5 },
    });

    const args = buildArgsByModel(spec);
    const configs = buildConfigsByModel(spec);

    expect(Object.hasOwn(Object.prototype, "planted_args")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "temperature")).toBe(false);
    expect(args && Object.entries(args)).toEqual([
      ["__proto__", { planted_args: 1 }],
    ]);
    expect(configs && Object.entries(configs)).toEqual([
      ["__proto__", { temperature: 0.5 }],
    ]);
  });

  it("keeps a constructor model's args off the Object constructor", () => {
    const spec = testEvalSpec({
      model: "constructor",
      model_args: { keys: "clobbered" },
    });

    const args = buildArgsByModel(spec);

    expect(Object.keys).toBe(objectKeys);
    expect(Object.hasOwn(Object, "keys")).toBe(true);
    expect(args && Object.entries(args)).toEqual([
      ["constructor", { keys: "clobbered" }],
    ]);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "keeps a role named %s as an ordinary entry",
    (role) => {
      const spec = testEvalSpec({
        model_roles: {
          [role]: config("mockllm/model", { temperature: 1 }, { planted: 1 }),
        },
      });

      expect(buildConfigsByRole(spec)).toEqual({ [role]: { temperature: 1 } });
      expect(buildArgsByRole(spec)).toEqual({ [role]: { planted: 1 } });
      expect(Object.hasOwn(Object.prototype, "planted")).toBe(false);
      expect(Object.hasOwn(Object.prototype, "temperature")).toBe(false);
    }
  );

  it("does not let a __proto__ key in model_args re-parent the record", () => {
    const spec = testEvalSpec({
      model: "mockllm/model",
      model_args: { ["__proto__"]: { planted_inner: 1 }, seed: 1 },
    });

    const args = buildArgsByModel(spec)?.["mockllm/model"];

    expect(Object.hasOwn(Object.prototype, "planted_inner")).toBe(false);
    expect(args && Object.entries(args)).toEqual([
      ["__proto__", { planted_inner: 1 }],
      ["seed", 1],
    ]);
  });

  it.each(["constructor", "toString", "hasOwnProperty"])(
    "reads an absent %s entry as undefined",
    (name) => {
      const spec = testEvalSpec({
        model: "mockllm/model",
        model_args: { seed: 1 },
      });
      const args = buildArgsByModel(spec);
      expect(args?.[name]).toBeUndefined();
      expect(args?.["mockllm/model"]?.[name]).toBeUndefined();
    }
  );
});
