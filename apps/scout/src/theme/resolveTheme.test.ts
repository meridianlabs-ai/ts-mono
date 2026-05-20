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

const readPref = (raw: string | null) =>
  readThemePreference(fakeStorage(raw), SETTINGS_STORAGE_KEY);

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
    "readable-light",
    "readable-dark",
  ])("returns persisted value '%s'", (value) => {
    expect(readPref(persisted(value))).toBe(value);
  });
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
      variant: "default",
      toggleBodyClass: true,
    });
  });

  it("standalone + system + dark OS → dark", () => {
    expect(resolveTheme({ ...baseInput, prefersDark: true })).toEqual({
      kind: "apply",
      theme: "dark",
      isDark: true,
      variant: "default",
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
      variant: "default",
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

  it("readable-light → base light, readable variant", () => {
    expect(
      resolveTheme({ ...baseInput, preference: "readable-light" })
    ).toEqual({
      kind: "apply",
      theme: "light",
      isDark: false,
      variant: "readable",
      toggleBodyClass: true,
    });
  });

  it("readable-dark → base dark, readable variant", () => {
    expect(resolveTheme({ ...baseInput, preference: "readable-dark" })).toEqual(
      {
        kind: "apply",
        theme: "dark",
        isDark: true,
        variant: "readable",
        toggleBodyClass: true,
      }
    );
  });

  it("readable-dark wins over light OS", () => {
    expect(
      resolveTheme({
        ...baseInput,
        preference: "readable-dark",
        prefersDark: false,
      })
    ).toMatchObject({ theme: "dark", isDark: true, variant: "readable" });
  });

  it("VS Code honors an explicit readable-dark param", () => {
    expect(
      resolveTheme({
        ...baseInput,
        isVscodeWebview: true,
        explicitParam: "readable-dark",
      })
    ).toEqual({
      kind: "apply",
      // `readable-` stripped for prism; skin is on data-theme-variant.
      theme: "dark",
      isDark: true,
      variant: "readable",
      toggleBodyClass: false,
    });
  });

  it("system + readable not selectable → default variant", () => {
    expect(resolveTheme({ ...baseInput, prefersDark: true })).toMatchObject({
      variant: "default",
    });
  });
});
