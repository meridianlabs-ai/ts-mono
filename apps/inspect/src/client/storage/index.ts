import JSON5 from "json5";

import { createWebviewStorage, getVscodeApi } from "@tsmono/util";

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

export default storage;
