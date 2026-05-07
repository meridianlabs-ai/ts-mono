import { describe, expect, it } from "vitest";

import {
  readThemePreference,
  resolveTheme,
  SETTINGS_STORAGE_KEY,
  ThemePreference,
} from "./resolveTheme";

const fakeStorage = (raw: string | null): Pick<Storage, "getItem"> => ({
  getItem: (key) => (key === SETTINGS_STORAGE_KEY ? raw : null),
});

const persisted = (themePreference?: unknown): string =>
  JSON.stringify({ state: { themePreference }, version: 0 });

describe("readThemePreference", () => {
  it("defaults to 'system' when storage is empty", () => {
    expect(readThemePreference(fakeStorage(null))).toBe("system");
  });

  it("defaults to 'system' when JSON is malformed", () => {
    expect(readThemePreference(fakeStorage("{not json"))).toBe("system");
  });

  it("defaults to 'system' when state is missing", () => {
    expect(readThemePreference(fakeStorage("{}"))).toBe("system");
  });

  it("defaults to 'system' when themePreference has unknown value", () => {
    expect(readThemePreference(fakeStorage(persisted("solar")))).toBe("system");
  });

  it.each<ThemePreference>(["system", "light", "dark"])(
    "returns persisted value '%s'",
    (value) => {
      expect(readThemePreference(fakeStorage(persisted(value)))).toBe(value);
    }
  );
});

describe("resolveTheme", () => {
  const baseInput = {
    preference: "system" as ThemePreference,
    explicitParam: null,
    isVscodeWebview: false,
    prefersDark: false,
  };

  it("standalone + system + light OS → light", () => {
    expect(resolveTheme({ ...baseInput, prefersDark: false })).toEqual({
      kind: "apply",
      theme: "light",
      isDark: false,
      toggleBodyClass: true,
    });
  });

  it("standalone + system + dark OS → dark", () => {
    expect(resolveTheme({ ...baseInput, prefersDark: true })).toEqual({
      kind: "apply",
      theme: "dark",
      isDark: true,
      toggleBodyClass: true,
    });
  });

  it("standalone + light override wins regardless of OS", () => {
    expect(
      resolveTheme({ ...baseInput, preference: "light", prefersDark: true })
    ).toMatchObject({ theme: "light", isDark: false });
  });

  it("standalone + dark override wins regardless of OS", () => {
    expect(
      resolveTheme({ ...baseInput, preference: "dark", prefersDark: false })
    ).toMatchObject({ theme: "dark", isDark: true });
  });

  it("VS Code + system + no explicit param → skip (let VS Code own theme)", () => {
    expect(resolveTheme({ ...baseInput, isVscodeWebview: true })).toEqual({
      kind: "skip",
    });
  });

  it("VS Code + explicit param 'vscode-dark' → apply, treated as dark", () => {
    expect(
      resolveTheme({
        ...baseInput,
        isVscodeWebview: true,
        explicitParam: "vscode-dark",
      })
    ).toEqual({
      kind: "apply",
      theme: "vscode-dark",
      isDark: true,
      toggleBodyClass: false,
    });
  });

  it.each<"light" | "dark">(["light", "dark"])(
    "VS Code ignores in-app override '%s' and skips",
    (preference) => {
      expect(
        resolveTheme({ ...baseInput, isVscodeWebview: true, preference })
      ).toEqual({ kind: "skip" });
    }
  );

  it("VS Code + explicit param wins even when override is also set", () => {
    expect(
      resolveTheme({
        ...baseInput,
        isVscodeWebview: true,
        preference: "light",
        explicitParam: "vscode-dark",
      })
    ).toMatchObject({ theme: "vscode-dark", isDark: true });
  });

  it("standalone + explicit param + system → uses explicit param", () => {
    expect(
      resolveTheme({ ...baseInput, explicitParam: "light", prefersDark: true })
    ).toMatchObject({ theme: "light", isDark: false });
  });

  it("user override beats explicit param", () => {
    expect(
      resolveTheme({
        ...baseInput,
        preference: "dark",
        explicitParam: "light",
      })
    ).toMatchObject({ theme: "dark", isDark: true });
  });
});
