/**
 * Framework-agnostic theme bootstrap shared by every viewer.
 *
 * Two CSS contracts this module has to satisfy together:
 *  - `data-bs-theme` on <html> drives Bootstrap's own light/dark tokens and
 *    the dark `--vscode-*` overrides in vscode.css (light defaults are
 *    ungated `:root`).
 *  - `body.vscode-dark` activates the `--vscode-* → --bs-*` bridge in
 *    base.css (`body[class^="vscode-"]`). We deliberately set only
 *    `vscode-dark` (never `vscode-light`) so light standalone stays on
 *    pure Bootstrap — see the comment at the toggle call below.
 *
 * Nothing here self-executes; callers must invoke the returned function.
 * That keeps the module import-safe for tests/SSR and lets the caller
 * control timing (the inline <script> calls it before first paint).
 */

export type ThemePreference =
  | "system"
  | "light"
  | "dark"
  | "readable-system"
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
  "readable-system",
  "readable-light",
  "readable-dark",
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
  // "system" and "readable-system" both follow the host/OS theme below.
  // VS Code webview: trust the host's body class over `matchMedia`, which
  // only reports the OS color scheme and so can disagree with the IDE theme.
  const hostIsDark = hostIsDarkFromBody();
  if (hostIsDark !== null) return hostIsDark;
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
      kind: "apply-variant-only";
      variant: ThemeVariant;
      /**
       * The host's resolved dark/light, so the variant token block keyed on
       * `:root[data-bs-theme="dark"]` activates when the host is dark.
       * `null` if we can't tell (no vscode-* body class yet) — caller then
       * leaves `data-bs-theme` untouched.
       */
      hostIsDark: boolean | null;
    }
  | {
      kind: "apply";
      theme: string;
      isDark: boolean;
      variant: ThemeVariant;
      toggleBodyClass: boolean;
    };

export const resolveTheme = (input: ResolveInput): ResolveOutput => {
  // Inside VS Code: the in-app preference wins when explicitly set; only on
  // `system` do we defer to VS Code's own theme machinery (or to a host
  // query param, which embedders use to force a specific theme).
  if (input.isVscodeWebview) {
    // In a webview the host injects `--vscode-*` tokens we cannot reliably
    // re-skin, so trying to override light/dark from inside always leaves
    // hybrid messes (host-tinted code blocks on user-picked backgrounds,
    // etc.). The host owns base mode. Event Colors (the readable variant)
    // is safe to override because it only flips `data-theme-variant` and
    // doesn't touch the bridge — apply it without changing the base theme.
    if (
      input.preference === "readable-light" ||
      input.preference === "readable-dark" ||
      input.preference === "readable-system" ||
      !input.explicitParam
    ) {
      // Mirror the host's body class onto `data-bs-theme` so the dark readable
      // token block follows Cursor/VS Code theme changes. Plain webview
      // preferences use the same path to clear a previously selected variant.
      const hostIsDark = hostIsDarkFromBody();
      return {
        kind: "apply-variant-only",
        variant: input.preference.startsWith("readable-")
          ? "readable"
          : "default",
        hostIsDark,
      };
    }
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
  // `readable-system` keeps the readable variant but follows the OS scheme
  // for base mode — so toggling OS dark/light still flips light/dark while
  // Event Colors stays on.
  if (input.preference !== "system" && input.preference !== "readable-system") {
    name = input.preference;
  } else if (input.explicitParam) {
    name = input.explicitParam;
  } else {
    name = input.prefersDark ? "dark" : "light";
  }
  if (input.preference === "readable-system" && !name.startsWith("readable-")) {
    name = `readable-${name}`;
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
let currentStorageKey: string | null = null;
let mediaListenerInstalled = false;
let bodyClassObserverInstalled = false;
let storageListenerInstalled = false;
// Subscribers re-render React state that depends on the resolved theme (the
// sun/moon icon, the "system" → host-dark/light resolution, etc.) when the
// host swaps `vscode-dark` ↔ `vscode-light` on <body>.
const hostThemeSubscribers = new Set<() => void>();
export const subscribeHostTheme = (cb: () => void): (() => void) => {
  hostThemeSubscribers.add(cb);
  return () => hostThemeSubscribers.delete(cb);
};

const hostIsDarkFromBody = (): boolean | null => {
  if (typeof document === "undefined" || !document.body) return null;
  const cls = document.body.classList;
  // VS Code high contrast: `vscode-high-contrast` is the HC-dark theme,
  // `vscode-high-contrast-light` the HC-light. Both classes are independent
  // tokens (classList is set-based), so order doesn't matter for correctness.
  if (cls.contains("vscode-high-contrast-light")) return false;
  if (cls.contains("vscode-high-contrast")) return true;
  if (cls.contains("vscode-dark")) return true;
  if (cls.contains("vscode-light")) return false;
  return null;
};

const isVscodeWebview = (): boolean =>
  typeof (window as { acquireVsCodeApi?: unknown }).acquireVsCodeApi ===
  "function";

const installBodyClassObserver = (): void => {
  if (
    bodyClassObserverInstalled ||
    typeof MutationObserver === "undefined" ||
    !document.body
  ) {
    return;
  }

  bodyClassObserverInstalled = true;
  let lastClass = document.body.className;
  new MutationObserver(() => {
    if (document.body.className === lastClass) return;
    lastClass = document.body.className;
    currentApplyTheme?.();
    hostThemeSubscribers.forEach((cb) => cb());
  }).observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
  });
};

/**
 * Build (do not run) the apply-theme function. The returned function is
 * idempotent and safe to call repeatedly (e.g. on a matchMedia change or a
 * preference change). It also registers itself as
 * `window.__APPLY_BROWSER_THEME__` and starts a `prefers-color-scheme`
 * listener on first call.
 */
export const createApplyTheme = (options: ApplyThemeOptions): (() => void) => {
  const applyTheme = (): void => {
    installBodyClassObserver();

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

    // Variant-only path: in a webview we never touch the host's base theme
    // (we can't re-skin `--vscode-*` reliably), but Event Colors is just a
    // `data-theme-variant` flip and is safe to apply on top.
    if (result.kind === "apply-variant-only") {
      if (result.variant === "readable") {
        document.documentElement.setAttribute("data-theme-variant", "readable");
      } else {
        document.documentElement.removeAttribute("data-theme-variant");
      }
      if (result.hostIsDark !== null) {
        document.documentElement.setAttribute(
          "data-bs-theme",
          result.hostIsDark ? "dark" : "light"
        );
      }
      return;
    }

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
  currentStorageKey = options.storageKey ?? null;
  window.__APPLY_BROWSER_THEME__ = applyTheme;

  if (!mediaListenerInstalled) {
    mediaListenerInstalled = true;
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => currentApplyTheme?.());
  }

  // Cross-tab sync: another tab wrote a new preference. Re-apply CSS in this
  // tab so its DOM matches. React stores still need their own listener to
  // keep state in sync (the bootstrap doesn't know about them).
  if (!storageListenerInstalled) {
    storageListenerInstalled = true;
    window.addEventListener("storage", (e) => {
      if (currentStorageKey && e.key === currentStorageKey) {
        currentApplyTheme?.();
      }
    });
  }

  // VS Code/Cursor swaps `vscode-dark` ↔ `vscode-light` on <body> when the
  // user changes the host theme. Re-apply so `data-bs-theme` / variant
  // tokens follow, and wake up React subscribers so the sun/moon icon and
  // any `resolveIsDark("system")` reads update too.
  installBodyClassObserver();

  return applyTheme;
};
