import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { ScalarValue } from "../../api/api";
import { useApi } from "../../state/store";

import { ColumnValuesParams, transcriptsColumnValuesQuery } from "./queries";

export const useTranscriptsColumnValues = (
  params: ColumnValuesParams | typeof skipToken
): AsyncData<ScalarValue[]> => {
  const api = useApi();
  return useAsyncDataFromQuery(transcriptsColumnValuesQuery(api, params));
};
