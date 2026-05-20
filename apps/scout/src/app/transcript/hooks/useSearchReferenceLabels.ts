import { useMemo } from "react";

import {
  buildSearchScope,
  normalizeSearchPanelState,
  useCachedSearchResult,
  type SearchScope,
} from "@tsmono/inspect-components/transcript-search";

import { useStore } from "../../../state/store";
import {
  getSearchPanelStateKey,
  useScoutSearchApi,
} from "../scoutSearchAdapters";

type UseSearchReferenceLabelsOptions = {
  scope: SearchScope;
  transcriptDir: string | null | undefined;
  transcriptId: string;
};

export type SearchReferenceLabels = {
  messageLabels?: Record<string, string>;
  eventLabels?: Record<string, string>;
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
  const cachedResult = useCachedSearchResult({
    api,
    scope: buildSearchScope(scope),
    searchId: transcriptDir ? searchId : null,
  });

  const referenceLabels = useMemo(() => {
    const messageLabels: Record<string, string> = {};
    const eventLabels: Record<string, string> = {};
    for (const ref of cachedResult.data?.references ?? []) {
      if (ref.type === "message" && ref.cite) {
        messageLabels[ref.id] = ref.cite;
      } else if (ref.type === "event" && ref.cite) {
        eventLabels[ref.id] = ref.cite;
      }
    }

    const hasMessageLabels = Object.keys(messageLabels).length > 0;
    const hasEventLabels = Object.keys(eventLabels).length > 0;
    if (!hasMessageLabels && !hasEventLabels) return undefined;

    return {
      ...(hasMessageLabels ? { messageLabels } : {}),
      ...(hasEventLabels ? { eventLabels } : {}),
    };
  }, [cachedResult.data]);

  return referenceLabels;
};
