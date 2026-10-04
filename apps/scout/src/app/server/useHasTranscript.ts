import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";

import { hasTranscriptQuery, TranscriptParams } from "./queries";

export const useHasTranscript = (
  params: TranscriptParams | typeof skipToken
): AsyncData<boolean> => {
  const api = useApi();
  return useAsyncDataFromQuery(hasTranscriptQuery(api, params));
};
