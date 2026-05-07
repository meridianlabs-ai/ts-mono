export const SETTINGS_STORAGE_KEY = "inspect-scout-user-settings";

export type ThemePreference = "system" | "light" | "dark";

export const isThemePreference = (value: unknown): value is ThemePreference =>
  value === "system" || value === "light" || value === "dark";

export const readThemePreference = (
  storage: Pick<Storage, "getItem">
): ThemePreference => {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return "system";
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "state" in parsed) {
      const state = parsed.state;
      if (state && typeof state === "object" && "themePreference" in state) {
        const value = state.themePreference;
        if (isThemePreference(value)) return value;
      }
    }
    return "system";
  } catch {
    return "system";
  }
};

export type ResolveInput = {
  preference: ThemePreference;
  explicitParam: string | null;
  isVscodeWebview: boolean;
  prefersDark: boolean;
};

export type ResolveOutput =
  | { kind: "skip" }
  | {
      kind: "apply";
      theme: string;
      isDark: boolean;
      toggleBodyClass: boolean;
    };

const isDarkTheme = (theme: string): boolean =>
  theme === "dark" || theme === "vscode-dark";

export const resolveTheme = (input: ResolveInput): ResolveOutput => {
  const userOverride = input.preference !== "system" ? input.preference : null;

  if (!userOverride && input.isVscodeWebview && !input.explicitParam) {
    return { kind: "skip" };
  }

  let theme: string;
  if (userOverride) {
    theme = userOverride;
  } else if (input.explicitParam) {
    theme = input.explicitParam;
  } else {
    theme = input.prefersDark ? "dark" : "light";
  }

  return {
    kind: "apply",
    theme,
    isDark: isDarkTheme(theme),
    toggleBodyClass: !input.isVscodeWebview || userOverride !== null,
  };
};
