import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import type { Condition } from "../../query";
import { useApi } from "../../state/store";

import { codeQuery } from "./queries";

export const useCode = (
  condition: Condition | typeof skipToken
): AsyncData<Record<string, string>> => {
  const api = useApi();
  return useAsyncDataFromQuery(codeQuery(api, condition));
};
