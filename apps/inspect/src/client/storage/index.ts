import JSON5 from "json5";

import { createWebviewStorage, getVscodeApi, isRecord } from "@tsmono/util";

import type { ClientStorage } from "../api/types";

const vscode = getVscodeApi();
export const webviewStorage = vscode
  ? createWebviewStorage(vscode, "app-storage")
  : undefined;

const storage: ClientStorage | undefined = webviewStorage
  ? {
      getItem: (name) => {
        const raw = webviewStorage.getItem(name);
        return raw === null ? null : JSON5.parse<unknown>(raw);
      },
      setItem: (name, value) => {
        webviewStorage.setItem(name, JSON5.stringify(value));
      },
      removeItem: (name) => webviewStorage.removeItem(name),
    }
  : undefined;

/** One-time compatibility with route checkpoints inside the old UI store. */
export function readLegacyRoute(): string | undefined {
  try {
    const saved = storage?.getItem("app-storage");
    if (
      !isRecord(saved) ||
      !isRecord(saved.state) ||
      !isRecord(saved.state.app)
    ) {
      return undefined;
    }
    const path = saved.state.app.urlHash;
    return typeof path === "string" ? path.replace(/^#/, "") : undefined;
  } catch {
    return undefined;
  }
}

export default storage;
