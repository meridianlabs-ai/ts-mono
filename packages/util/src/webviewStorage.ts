import { isRecord } from "./type";
import type { VSCodeApi } from "./vscode";

export interface WebviewStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Named, independent snapshots within VS Code's single webview state slot. */
export function createWebviewStorage(
  api: VSCodeApi,
  legacyKey?: string
): WebviewStorage {
  const read = (): Record<string, unknown> => {
    const state = api.getState();
    // Inspect originally stored its entire Zustand envelope as one string.
    if (typeof state === "string" && legacyKey) return { [legacyKey]: state };
    return isRecord(state) ? state : {};
  };

  return {
    getItem: (key) => {
      const state = read();
      const value = Object.hasOwn(state, key) ? state[key] : undefined;
      return typeof value === "string" ? value : null;
    },
    setItem: (key, value) => {
      api.setState({ ...read(), [key]: value });
    },
    removeItem: (key) => {
      const state = { ...read() };
      delete state[key];
      api.setState(state);
    },
  };
}
