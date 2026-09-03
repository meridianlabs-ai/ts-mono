import { describe, expect, it } from "vitest";

import { ProjectConfigInput } from "../../types/api-types";

import {
  computeConfigToSave,
  filterNullValues,
  initializeEditedConfig,
  mergeInFlightEdits,
} from "./configUtils";

// A rendered transcript could once write onto Object.prototype (a JSON-pointer
// state diff through `/__proto__/...`). The config builders must never turn
// such inherited members into own keys of the PUT body, so these tests
// pollute the real prototype for the duration of one call and clean up.
const withPollutedPrototype = (
  key: string,
  value: unknown,
  run: () => void
): void => {
  Object.defineProperty(Object.prototype, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  try {
    run();
  } finally {
    Reflect.deleteProperty(Object.prototype, key);
  }
};

describe("filterNullValues", () => {
  it("drops null and undefined values", () => {
    expect(filterNullValues({ a: 1, b: null, c: undefined, d: "x" })).toEqual({
      a: 1,
      d: "x",
    });
  });

  it("copies own properties only", () => {
    withPollutedPrototype("system_message", "attacker prompt", () => {
      const result = filterNullValues({ temperature: 0.5 });
      expect(Object.keys(result)).toEqual(["temperature"]);
    });
  });
});

describe("initializeEditedConfig", () => {
  it("treats a field the server omitted as unset, not as the prototype's", () => {
    withPollutedPrototype(
      "generate_config",
      { system_message: "planted" },
      () => {
        const edited = initializeEditedConfig({ filter: "kind == 'eval'" });
        expect(edited.generate_config).toBeNull();
        expect(edited.model).toBeNull();
      }
    );
  });
});

describe("computeConfigToSave", () => {
  const serverConfig: ProjectConfigInput = {
    filter: "kind == 'eval'",
    model: "openai/gpt-5.4",
    validation: {},
  };

  it("sends the fields the editor owns and drops unchanged empty ones", () => {
    const edited = initializeEditedConfig(serverConfig);
    const original = structuredClone(edited);
    expect(computeConfigToSave(edited, original, serverConfig)).toEqual({
      filter: "kind == 'eval'",
      model: "openai/gpt-5.4",
    });
  });

  it("does not read a server-only key through the prototype chain", () => {
    // `validation` is always an own key of the server config, so it is always
    // in the key set but never in the editor's state.
    withPollutedPrototype("validation", { planted: "x == 1" }, () => {
      const edited = initializeEditedConfig(serverConfig);
      const original = structuredClone(edited);
      const result = computeConfigToSave(edited, original, serverConfig);
      expect(Object.hasOwn(result, "validation")).toBe(false);
      expect(JSON.stringify(result)).not.toContain("planted");
    });
  });

  it("does not persist a planted model_roles the user never set", () => {
    const planted = {
      grader: { model: "openai/gpt-4o", base_url: "https://attacker.example" },
    };
    withPollutedPrototype("model_roles", planted, () => {
      const withRoles: ProjectConfigInput = {
        ...serverConfig,
        model_roles: { grader: "openai/gpt-5.4" },
      };
      const edited = initializeEditedConfig(withRoles);
      const original = structuredClone(edited);
      const result = computeConfigToSave(edited, original, withRoles);
      expect(Object.hasOwn(result, "model_roles")).toBe(false);
      expect(JSON.stringify(result)).not.toContain("attacker.example");
    });
  });

  it("falls back to the server filter, not the prototype's, when unset", () => {
    withPollutedPrototype("filter", "planted == 1", () => {
      // An empty-array filter is dropped from the payload as unchanged and
      // empty, so the fallback read must not find a planted value instead.
      const emptyFilter: ProjectConfigInput = { ...serverConfig, filter: [] };
      const edited = initializeEditedConfig(emptyFilter);
      const original = structuredClone(edited);
      const result = computeConfigToSave(edited, original, emptyFilter);
      expect(result.filter).toEqual([]);
    });
  });

  it("still sends a value the user actually set on that key", () => {
    withPollutedPrototype("model_base_url", "https://attacker.example", () => {
      const edited = {
        ...initializeEditedConfig(serverConfig),
        model_base_url: "https://proxy.internal/v1",
      };
      const original = structuredClone(initializeEditedConfig(serverConfig));
      const result = computeConfigToSave(edited, original, serverConfig);
      expect(result.model_base_url).toBe("https://proxy.internal/v1");
    });
  });

  it("does not send a planted value for an editable field the server omitted", () => {
    withPollutedPrototype("model_base_url", "https://attacker.example", () => {
      const edited = initializeEditedConfig(serverConfig);
      const original = structuredClone(edited);
      const result = computeConfigToSave(edited, original, serverConfig);
      expect(Object.hasOwn(result, "model_base_url")).toBe(false);
    });
  });

  it("treats a generate_config key absent from the original as unset", () => {
    withPollutedPrototype("system_message", "planted", () => {
      const edited = {
        ...initializeEditedConfig(serverConfig),
        generate_config: { system_message: null },
      };
      const original = structuredClone(initializeEditedConfig(serverConfig));
      const result = computeConfigToSave(edited, original, serverConfig);
      // Clearing a field the original never had is a no-op, not a `null`
      // write that only exists because the original read the planted value.
      expect(result.generate_config).toBeUndefined();
    });
  });
});

describe("mergeInFlightEdits", () => {
  const persisted: Partial<ProjectConfigInput> = {
    filter: "kind == 'eval'",
    model: "openai/gpt-5.4",
    tags: null,
  };

  it("returns the persisted config when nothing changed during the save", () => {
    const snapshot: Partial<ProjectConfigInput> = {
      filter: "old",
      model: "openai/gpt-5.4",
      tags: null,
    };
    expect(mergeInFlightEdits(persisted, snapshot, snapshot)).toEqual(
      persisted
    );
  });

  it("keeps fields edited while the save was in flight", () => {
    const snapshot: Partial<ProjectConfigInput> = {
      filter: "old",
      model: "openai/gpt-5.4",
      tags: null,
    };
    const current: Partial<ProjectConfigInput> = {
      ...snapshot,
      tags: ["typed-during-save"],
    };
    expect(mergeInFlightEdits(persisted, current, snapshot)).toEqual({
      ...persisted,
      tags: ["typed-during-save"],
    });
  });

  it("shows server divergence for fields the user left alone", () => {
    // e.g. computeConfigToSave pins a cleared required `filter` back to the
    // server's value — the response must win over the stale editor state.
    const snapshot: Partial<ProjectConfigInput> = {
      filter: undefined,
      model: "openai/gpt-5.4",
      tags: null,
    };
    const merged = mergeInFlightEdits(persisted, snapshot, snapshot);
    expect(merged.filter).toBe("kind == 'eval'");
  });

  it("compares by value, not identity", () => {
    const snapshot: Partial<ProjectConfigInput> = { tags: ["a"] };
    const current: Partial<ProjectConfigInput> = { tags: ["a"] };
    expect(mergeInFlightEdits(persisted, current, snapshot)).toEqual(persisted);
  });
});
