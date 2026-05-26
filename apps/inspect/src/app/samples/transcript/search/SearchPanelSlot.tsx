import { FC } from "react";

import {
  SearchPanel,
  type SearchScope,
} from "@tsmono/inspect-components/transcript-search";

import {
  useInspectSearchApi,
  useInspectSearchModelHistory,
  useInspectSearchNavigation,
  useInspectSearchPanelState,
  type InspectSearchContext,
} from "./inspectSearchAdapters";

interface SearchPanelSlotProps {
  scope: SearchScope;
  context: InspectSearchContext;
  onClose: () => void;
}

/**
 * Bundles the four adapter hooks and renders the shared SearchPanel.
 * Callers obtain `context` from `useInspectSearchContext(sample)`, which
 * encapsulates the "is this sample searchable + can we build URLs?" decision.
 */
export const SearchPanelSlot: FC<SearchPanelSlotProps> = ({
  scope,
  context,
  onClose,
}) => {
  const { transcriptId, logFile, logPath, sampleId, sampleEpoch } = context;
  const api = useInspectSearchApi(logFile, transcriptId);
  const stateController = useInspectSearchPanelState({
    scope,
    logFile,
    transcriptId,
  });
  const navigation = useInspectSearchNavigation({
    logPath,
    sampleId,
    sampleEpoch,
  });
  const modelHistory = useInspectSearchModelHistory();

  if (!api) return null;

  return (
    <SearchPanel
      scope={scope}
      api={api}
      stateController={stateController}
      navigation={navigation}
      modelHistory={modelHistory}
      onClose={onClose}
    />
  );
};
