/**
 * Framework-agnostic theme bootstrap shared by every viewer.
 *
 * The CSS bridge in `base.css` maps `--vscode-*` → `--bs-*` only under
 * `body[class^="vscode-"]`, while the standalone light/dark `--vscode-*`
 * fallbacks in `vscode.css` are gated on `:root[data-bs-theme]`. So a fully
 * themed standalone page needs BOTH the `data-bs-theme` attribute (on
 * <html>) and a `vscode-*` class (on <body>) — setting only the former
 * leaves bridged tokens light. This module owns that contract so every app
 * applies it identically.
 *
 * Nothing here self-executes; callers must invoke the returned function.
 * That keeps the module import-safe for tests/SSR and lets the caller
 * control timing (the inline <script> calls it before first paint).
 */

export type ThemePreference =
  | "system"
  | "light"
  | "dark"
  | "readable-light"
  | "readable-dark";

/**
 * Orthogonal-in-spirit "variant" axis kept separate from light/dark so a
 * readable theme is one small token-override block per base mode rather
 * than a duplicated stylesheet. (The user-facing preference is a flat list
 * — `readable-*` — but it still resolves down to base + variant here.)
 */
export type ThemeVariant = "default" | "readable";

const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
  "readable-light",
  "readable-dark",
];

/** Menu metadata — single source of truth for the theme picker UI. */
export const THEME_OPTIONS: readonly {
  value: ThemePreference;
  label: string;
}[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "readable-light", label: "Event Colors Light" },
  { value: "readable-dark", label: "Event Colors Dark" },
];

export const isThemePreference = (value: unknown): value is ThemePreference =>
  THEME_PREFERENCES.includes(value as ThemePreference);

/**
 * Resolved dark/light for a preference — drives the toggle's icon and
 * flip direction. For `system` it reads the OS color scheme. (Host
 * query-param overrides are intentionally ignored: the in-app picker is
 * only surfaced standalone.)
 */
export const resolveIsDark = (value: ThemePreference): boolean => {
  if (value === "dark" || value === "readable-dark") return true;
  if (value === "light" || value === "readable-light") return false;
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
};

/**
 * Decompose any theme name (a preference, a host query param, or a
 * computed system value) into its base mode + variant. Tolerant of the
 * VS Code-style `vscode-dark`/`vscode-light` strings hosts may pass.
 */
const parseThemeName = (
  name: string
): { isDark: boolean; variant: ThemeVariant; base: string } => {
  const variant: ThemeVariant = name.startsWith("readable-")
    ? "readable"
    : "default";
  const isDark = name === "dark" || name.endsWith("-dark");
  const base = name.startsWith("readable-")
    ? name.slice("readable-".length)
    : name;
  return { isDark, variant, base };
};

/**
 * Read a persisted `themePreference` out of a zustand-persisted settings
 * blob. Apps that have no preference store omit `storageKey` and always
 * resolve to `system`.
 */
export const readThemePreference = (
  storage: Pick<Storage, "getItem">,
  storageKey: string
): ThemePreference => {
  try {
    const raw = storage.getItem(storageKey);
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
      variant: ThemeVariant;
      toggleBodyClass: boolean;
    };

export const resolveTheme = (input: ResolveInput): ResolveOutput => {
  // Inside VS Code we always defer to VS Code's own theme machinery; the
  // in-app preference is hidden in that environment, so any persisted
  // override from a standalone session must stay inert. An explicit theme
  // query parameter is still honored since callers use it to embed a
  // viewer with a specific theme (and may itself request `readable-*`).
  if (input.isVscodeWebview) {
    if (!input.explicitParam) return { kind: "skip" };
    const parsed = parseThemeName(input.explicitParam);
    return {
      kind: "apply",
      // Strip `readable-` so prism gets a value it recognizes; the skin
      // rides on the separate data-theme-variant attribute.
      theme: parsed.base,
      isDark: parsed.isDark,
      variant: parsed.variant,
      toggleBodyClass: false,
    };
  }

  let name: string;
  if (input.preference !== "system") {
    name = input.preference;
  } else if (input.explicitParam) {
    name = input.explicitParam;
  } else {
    name = input.prefersDark ? "dark" : "light";
  }

  const { isDark, variant, base } = parseThemeName(name);
  return {
    kind: "apply",
    // Strip the `readable-` prefix: `data-text-highlight` keys the prism
    // syntax theme on plain light/dark, and the readable skin rides on the
    // separate `data-theme-variant` attribute.
    theme: base,
    isDark,
    variant,
    toggleBodyClass: true,
  };
};

export type ApplyThemeOptions = {
  /**
   * URL query parameter a host iframe uses to force a theme. inspect uses
   * `inspectLogviewThemeCategory`; scout/hawk use `inspectViewThemeCategory`.
   */
  queryParamName: string;
  /** localStorage key for the persisted preference; omit if none. */
  storageKey?: string;
};

declare global {
  interface Window {
    __APPLY_BROWSER_THEME__?: () => void;
  }
}

// A single stable matchMedia listener delegates to the most recently built
// applyTheme, so repeated createApplyTheme calls (HMR, tests, an app that
// re-inits) never accumulate listeners or leak.
let currentApplyTheme: (() => void) | null = null;
let mediaListenerInstalled = false;

const isVscodeWebview = (): boolean =>
  typeof (window as { acquireVsCodeApi?: unknown }).acquireVsCodeApi ===
  "function";

/**
 * Build (do not run) the apply-theme function. The returned function is
 * idempotent and safe to call repeatedly (e.g. on a matchMedia change or a
 * preference change). It also registers itself as
 * `window.__APPLY_BROWSER_THEME__` and starts a `prefers-color-scheme`
 * listener on first call.
 */
export const createApplyTheme = (
  options: ApplyThemeOptions
): (() => void) => {
  const applyTheme = (): void => {
    const params = new URLSearchParams(window.location.search);
    const result = resolveTheme({
      preference: options.storageKey
        ? readThemePreference(localStorage, options.storageKey)
        : "system",
      explicitParam: params.get(options.queryParamName),
      isVscodeWebview: isVscodeWebview(),
      prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
    });

    if (result.kind === "skip") return;

    // data-* attributes belong on <html> (CSS gates `:root[data-bs-theme]`);
    // the vscode-* class belongs on <body> (CSS gates `body[class^=...]`).
    // Splitting elements here is deliberate — keep them in lockstep.
    document.documentElement.setAttribute("data-text-highlight", result.theme);
    document.documentElement.setAttribute(
      "data-bs-theme",
      result.isDark ? "dark" : "light"
    );

    // The readable skin is a small token-override block keyed on this
    // attribute (see base.css); absent attribute = the design-consistent
    // default, so we remove rather than set "default".
    if (result.variant === "readable") {
      document.documentElement.setAttribute("data-theme-variant", "readable");
    } else {
      document.documentElement.removeAttribute("data-theme-variant");
    }

    // Only `vscode-dark` is toggled (never a `vscode-light` class): in light
    // standalone the bridge stays OFF so the `:root` Bootstrap + light
    // `--vscode-*` defaults apply, matching scout's long-shipped behavior.
    // Adding `vscode-light` would activate the bridge in light mode and
    // silently re-skin every `--bs-*` token.
    if (result.toggleBodyClass) {
      document.body?.classList.toggle("vscode-dark", result.isDark);
    }
  };

  currentApplyTheme = applyTheme;
  window.__APPLY_BROWSER_THEME__ = applyTheme;

  if (!mediaListenerInstalled) {
    mediaListenerInstalled = true;
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => currentApplyTheme?.());
  }

  return applyTheme;
};
