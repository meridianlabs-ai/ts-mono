import { readThemePreference, resolveTheme } from "./resolveTheme";

declare global {
  interface Window {
    __SCOUT_APPLY_BROWSER_THEME__?: () => void;
  }
}

const applyTheme = (): void => {
  const params = new URLSearchParams(window.location.search);
  const result = resolveTheme({
    preference: readThemePreference(localStorage),
    explicitParam: params.get("inspectViewThemeCategory"),
    isVscodeWebview: typeof window.acquireVsCodeApi === "function",
    prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
  });

  if (result.kind === "skip") return;

  document.documentElement.setAttribute("data-text-highlight", result.theme);
  document.documentElement.setAttribute(
    "data-bs-theme",
    result.isDark ? "dark" : "light"
  );

  if (result.toggleBodyClass) {
    document.body?.classList.toggle("vscode-dark", result.isDark);
  }
};

window.__SCOUT_APPLY_BROWSER_THEME__ = applyTheme;
applyTheme();

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", applyTheme);
