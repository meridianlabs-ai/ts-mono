import { useMemo } from "react";

import { useStore } from "../../../state/store";
import {
  getSearchPanelStateKey,
  normalizeSearchPanelState,
} from "../searchPanelState";
import type { TranscriptSearchScope } from "../searchRequest";

type UseSearchReferenceLabelsOptions = {
  scope: TranscriptSearchScope;
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
      transcriptDir
        ? getSearchPanelStateKey({
            scope,
            transcriptDir,
            transcriptId,
          })
        : null,
    [scope, transcriptDir, transcriptId]
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

  const searchResult = useMemo(() => {
    const activeSearch = searchPanelState.searches[searchPanelState.searchType];
    return activeSearch.hasSearched ? activeSearch.currentSearch : null;
  }, [searchPanelState]);

  const referenceLabels = useMemo(() => {
    const messageLabels: Record<string, string> = {};
    const eventLabels: Record<string, string> = {};
    for (const ref of searchResult?.references ?? []) {
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
  }, [searchResult]);

  return referenceLabels;
};
