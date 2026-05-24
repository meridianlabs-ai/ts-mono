import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createApplyTheme,
  readThemePreference,
  resolveTheme,
  ThemePreference,
} from "./bootstrap";

const SETTINGS_STORAGE_KEY = "test-user-settings";

const fakeStorage = (raw: string | null): Pick<Storage, "getItem"> => ({
  getItem: (key) => (key === SETTINGS_STORAGE_KEY ? raw : null),
});

const readPref = (raw: string | null) =>
  readThemePreference(fakeStorage(raw), SETTINGS_STORAGE_KEY);

const persisted = (themePreference?: unknown): string =>
  JSON.stringify({ state: { themePreference }, version: 0 });

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it("VS Code + system + no explicit param → clears variant only", () => {
    expect(resolveTheme({ ...baseInput, isVscodeWebview: true })).toEqual({
      kind: "apply-variant-only",
      variant: "default",
      hostIsDark: null,
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
    "VS Code ignores plain light/dark override '%s' (host owns base mode)",
    (preference) => {
      expect(
        resolveTheme({ ...baseInput, isVscodeWebview: true, preference })
      ).toEqual({
        kind: "apply-variant-only",
        variant: "default",
        hostIsDark: null,
      });
    }
  );

  it.each<"readable-system" | "readable-light" | "readable-dark">([
    "readable-system",
    "readable-light",
    "readable-dark",
  ])(
    "VS Code applies Event Colors '%s' as variant-only (host keeps base mode)",
    (preference) => {
      expect(
        resolveTheme({ ...baseInput, isVscodeWebview: true, preference })
      ).toEqual({
        kind: "apply-variant-only",
        variant: "readable",
        // jsdom: no `vscode-*` class on <body>, so caller is told to leave
        // `data-bs-theme` alone.
        hostIsDark: null,
      });
    }
  );

  it.each([
    ["vscode-dark", true],
    ["vscode-light", false],
  ])(
    "VS Code mirrors host class '%s' for Event Colors",
    (className, hostIsDark) => {
      vi.stubGlobal("document", {
        body: {
          classList: {
            contains: (candidate: string) => candidate === className,
          },
        },
      });

      expect(
        resolveTheme({
          ...baseInput,
          isVscodeWebview: true,
          preference: "readable-system",
        })
      ).toEqual({
        kind: "apply-variant-only",
        variant: "readable",
        hostIsDark,
      });
    }
  );

  it("VS Code clears readable DOM variant when Event Colors is turned off", () => {
    const attrs = new Map<string, string>();
    const storage = new Map<string, string>([
      [SETTINGS_STORAGE_KEY, persisted("readable-system")],
    ]);
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: (name: string, value: string) => attrs.set(name, value),
        removeAttribute: (name: string) => attrs.delete(name),
      },
      body: {
        className: "vscode-dark",
        classList: {
          contains: (candidate: string) => candidate === "vscode-dark",
          toggle: vi.fn(),
        },
      },
    });
    vi.stubGlobal("window", {
      location: { search: "" },
      matchMedia: () => ({
        matches: false,
        addEventListener: vi.fn(),
      }),
      addEventListener: vi.fn(),
      acquireVsCodeApi: vi.fn(),
    });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
    });

    const applyTheme = createApplyTheme({
      queryParamName: "inspectLogviewThemeCategory",
      storageKey: SETTINGS_STORAGE_KEY,
    });
    applyTheme();
    expect(attrs.get("data-theme-variant")).toBe("readable");
    expect(attrs.get("data-bs-theme")).toBe("dark");

    storage.set(SETTINGS_STORAGE_KEY, persisted("system"));
    applyTheme();
    expect(attrs.has("data-theme-variant")).toBe(false);
    expect(attrs.get("data-bs-theme")).toBe("dark");
  });

  it("standalone + readable-system follows OS scheme but keeps readable variant", () => {
    expect(
      resolveTheme({
        ...baseInput,
        preference: "readable-system",
        prefersDark: true,
      })
    ).toMatchObject({ theme: "dark", isDark: true, variant: "readable" });
    expect(
      resolveTheme({
        ...baseInput,
        preference: "readable-system",
        prefersDark: false,
      })
    ).toMatchObject({ theme: "light", isDark: false, variant: "readable" });
  });

  it("VS Code + explicit param applies when preference is not a readable override", () => {
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
