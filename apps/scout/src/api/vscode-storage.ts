/**
 * VS Code storage adapter for ClientStorage interface.
 */

import { isRecord, VSCodeApi } from "@tsmono/util";

import { ClientStorage } from "./api";

export const createVSCodeStore = (api: VSCodeApi): ClientStorage => ({
  getItem: (key: string): string | null => {
    const state = api.getState();
    if (!isRecord(state)) {
      return null;
    }
    const value = state[key];
    return typeof value === "string" && value ? value : null;
  },
  setItem: (key: string, value: string): void => {
    const existingState = api.getState();
    const state: Record<string, unknown> = isRecord(existingState)
      ? existingState
      : {};
    state[key] = value;
    api.setState(state);
  },
  removeItem: (key: string): void => {
    const existingState = api.getState();
    if (isRecord(existingState)) {
      delete existingState[key];
      api.setState(existingState);
    }
  },
});
