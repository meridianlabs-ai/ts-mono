import { describe, expect, it } from "vitest";

import { ProjectConfigInput } from "../../types/api-types";

import { mergeInFlightEdits } from "./configUtils";

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
    expect(mergeInFlightEdits(persisted, current, snapshot)).toEqual(
      persisted
    );
  });
});
