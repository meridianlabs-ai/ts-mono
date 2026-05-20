import { FC } from "react";

import {
  SearchPanel,
  type SearchScope,
} from "@tsmono/inspect-components/transcript-search";

import {
  INSPECT_SEARCH_ICONS,
  useInspectSearchApi,
  useInspectSearchModelHistory,
  useInspectSearchNavigation,
  useInspectSearchPanelState,
} from "./inspectSearchAdapters";

interface SearchPanelSlotProps {
  scope: SearchScope;
  logFile: string;
  logPath: string;
  transcriptId: string;
  sampleId: string | number;
  sampleEpoch: number;
  onClose: () => void;
}

/**
 * Bundles the four adapter hooks and renders the shared SearchPanel.
 * Callers only need to know the sample identity and how to close the panel —
 * mounting is identical between the transcript tab (rendered in
 * TranscriptLayout's rightPane slot) and the messages tab (rendered as a
 * sibling of ChatViewVirtualList).
 */
export const SearchPanelSlot: FC<SearchPanelSlotProps> = ({
  scope,
  logFile,
  logPath,
  transcriptId,
  sampleId,
  sampleEpoch,
  onClose,
}) => {
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
      icons={INSPECT_SEARCH_ICONS}
      modelHistory={modelHistory}
      onClose={onClose}
    />
  );
};
