import { useMemo } from "react";

import {
  normalizeSearchPanelState,
  useCachedSearchReferenceLabels,
  type SearchReferenceLabels,
  type SearchScope,
} from "@tsmono/inspect-components/transcript-search";

import { useStore } from "../../../state/store";
import {
  getSearchPanelStateKey,
  useScoutSearchApi,
} from "../scoutSearchAdapters";

export type { SearchReferenceLabels };

type UseSearchReferenceLabelsOptions = {
  scope: SearchScope;
  transcriptDir: string | null | undefined;
  transcriptId: string;
};

export const useSearchReferenceLabels = ({
  scope,
  transcriptDir,
  transcriptId,
}: UseSearchReferenceLabelsOptions): SearchReferenceLabels | undefined => {
  const searchPanelStateKey = useMemo(
    () =>
      transcriptDir ? getSearchPanelStateKey({ scope, transcriptDir }) : null,
    [scope, transcriptDir]
  );

  const storedSearchPanelState = useStore((state) =>
    searchPanelStateKey
      ? state.searchPanelStates[searchPanelStateKey]
      : undefined
  );

  const searchPanelState = useMemo(
    () => normalizeSearchPanelState(storedSearchPanelState),
    [storedSearchPanelState]
  );

  const searchId =
    searchPanelState.searches[searchPanelState.searchType].searchId;

  const api = useScoutSearchApi(transcriptDir ?? "", transcriptId);

  return useCachedSearchReferenceLabels({
    api,
    scope,
    searchId: transcriptDir ? searchId : null,
  });
};
