import JSON5 from "json5";

import { getVscodeApi } from "@tsmono/util";

import { PersistedState } from "../../state/store";
import { ClientStorage } from "../api/types";

const resolveStorage = (): ClientStorage | undefined => {
  const vscodeApi = getVscodeApi();
  if (vscodeApi) {
    return {
      getItem: (
        _name: string
      ): {
        state: PersistedState;
        version: number;
      } => {
        const state = vscodeApi.getState();
        if (typeof state !== "string") {
          throw new Error("vscode state is not a serialized string");
        }
        return JSON5.parse<{
          state: PersistedState;
          version: number;
        }>(state);
      },
      setItem: (_name: string, value: unknown) => {
        // zustand-persist hands back what getItem returned; it round-trips
        // through JSON5 either way, so no shape claim is needed here.
        vscodeApi.setState(JSON5.stringify(value));
      },
      removeItem: (_name: string) => {
        vscodeApi.setState(null);
      },
    };
  }
  return undefined;
};

export default resolveStorage();
