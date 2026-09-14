import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { ScalarValue } from "../../api/api";
import { useApi } from "../../state/store";

import { ColumnValuesParams, scansColumnValuesQuery } from "./queries";

export const useScansColumnValues = (
  params: ColumnValuesParams | typeof skipToken
): AsyncData<ScalarValue[]> => {
  const api = useApi();
  return useAsyncDataFromQuery(scansColumnValuesQuery(api, params));
};
