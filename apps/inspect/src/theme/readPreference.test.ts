import { describe, expect, it } from "vitest";

import type { ThemePreference } from "@tsmono/inspect-common/theme/bootstrap";

import { SETTINGS_STORAGE_KEY } from "./constants";
import { readThemePreference } from "./readPreference";

const fakeStorage = (raw: string | null): Pick<Storage, "getItem"> => ({
  getItem: (key) => (key === SETTINGS_STORAGE_KEY ? raw : null),
});

const readPref = (raw: string | null) => readThemePreference(fakeStorage(raw));

const persisted = (themePreference?: unknown): string =>
  JSON.stringify({ state: { themePreference }, version: 0 });

describe("readThemePreference", () => {
  it("defaults to 'system' when storage is empty", () => {
    expect(readPref(null)).toBe("system");
  });

  it("defaults to 'system' when JSON is malformed", () => {
    expect(readPref("{not json")).toBe("system");
  });

  it("defaults to 'system' when state is missing", () => {
    expect(readPref("{}")).toBe("system");
  });

  it("defaults to 'system' when themePreference has unknown value", () => {
    expect(readPref(persisted("solar"))).toBe("system");
  });

  it.each<ThemePreference>([
    "system",
    "light",
    "dark",
    "readable-system",
    "readable-light",
    "readable-dark",
  ])("returns persisted value '%s'", (value) => {
    expect(readPref(persisted(value))).toBe(value);
  });
});
