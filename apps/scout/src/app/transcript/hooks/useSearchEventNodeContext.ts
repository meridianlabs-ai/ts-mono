import { useMemo } from "react";

import type { EventNodeContext } from "@tsmono/inspect-components/transcript";

import { useStore } from "../../../state/store";
import {
  getSearchPanelStateKey,
  normalizeSearchPanelState,
} from "../searchPanelState";
import type { TranscriptSearchScope } from "../searchRequest";

type UseSearchEventNodeContextOptions = {
  scope: TranscriptSearchScope;
  transcriptDir: string | null | undefined;
  transcriptId: string;
};

export const useSearchEventNodeContext = ({
  scope,
  transcriptDir,
  transcriptId,
}: UseSearchEventNodeContextOptions): Partial<EventNodeContext> | undefined => {
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

  const messageLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const ref of searchResult?.references ?? []) {
      if (ref.type === "message" && ref.cite) {
        map[ref.id] = ref.cite;
      }
    }
    return map;
  }, [searchResult]);

  return useMemo(
    () =>
      Object.keys(messageLabels).length > 0 ? { messageLabels } : undefined,
    [messageLabels]
  );
};
