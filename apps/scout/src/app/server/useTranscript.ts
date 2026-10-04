import { skipToken } from "@tanstack/react-query";

import { useAsyncDataFromQuery } from "@tsmono/react/hooks";
import { AsyncData } from "@tsmono/util";

import { useApi } from "../../state/store";
import { Transcript } from "../../types/api-types";

import { TranscriptParams, transcriptQuery } from "./queries";

export const useTranscript = (
  params: TranscriptParams | typeof skipToken
): AsyncData<Transcript> => {
  const api = useApi();
  return useAsyncDataFromQuery(transcriptQuery(api, params));
};
