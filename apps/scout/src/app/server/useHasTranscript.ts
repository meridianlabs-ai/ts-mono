import { skipToken } from "@tanstack/react-query";

import { AsyncData, useAsyncDataFromQuery } from "@tsmono/util";

import { useApi } from "../../state/store";

type HasTranscriptParams = {
  location: string;
  id: string;
};

export const useHasTranscript = (
  params: HasTranscriptParams | typeof skipToken
): AsyncData<boolean> => {
  const api = useApi();

  return useAsyncDataFromQuery({
    queryKey: params === skipToken ? [skipToken] : ["has_transcript", params],
    queryFn:
      params === skipToken
        ? skipToken
        : () => api.hasTranscript(params.location, params.id),
    staleTime: Infinity,
  });
};
