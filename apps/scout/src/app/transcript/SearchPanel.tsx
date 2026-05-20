import { FC } from "react";

import { SearchPanel as SharedSearchPanel } from "@tsmono/inspect-components/transcript-search";
import type { SearchScope } from "@tsmono/inspect-components/transcript-search";

import { useProjectConfig } from "../server/useProjectConfig";

import {
  SCOUT_SEARCH_ICONS,
  useScoutSearchApi,
  useScoutSearchModelHistory,
  useScoutSearchNavigation,
  useScoutSearchPanelState,
} from "./scoutSearchAdapters";

type SearchPanelProps = {
  scope: SearchScope;
  transcriptDir: string;
  transcriptId: string;
  onClose: () => void;
};

export const SearchPanel: FC<SearchPanelProps> = ({
  scope,
  transcriptDir,
  transcriptId,
  onClose,
}) => {
  const projectConfig = useProjectConfig();
  const api = useScoutSearchApi(transcriptDir, transcriptId);
  const stateController = useScoutSearchPanelState({ scope, transcriptDir });
  const navigation = useScoutSearchNavigation();
  const modelHistory = useScoutSearchModelHistory();

  return (
    <SharedSearchPanel
      scope={scope}
      api={api}
      stateController={stateController}
      navigation={navigation}
      icons={SCOUT_SEARCH_ICONS}
      defaultModel={projectConfig.data?.config.model ?? undefined}
      modelHistory={modelHistory}
      onClose={onClose}
    />
  );
};
