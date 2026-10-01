import { FC, ReactNode } from "react";

import { logContentTrust } from "@tsmono/inspect-components/content";
import { ContentTrustProvider } from "@tsmono/react/components";

import { useLogDir } from "../../app_config";
import { useLogHeader } from "../../log_data";
import { useStore } from "../../state/store";

/**
 * Trust for one log's content: untrusted when no log is given, or while its
 * header hasn't loaded.
 */
const LogContentTrustProvider: FC<{
  logFile: string | undefined;
  children: ReactNode;
}> = ({ logFile, children }) => {
  const logDir = useLogDir();
  const header = useLogHeader(logDir, logFile, { demand: "passive" });
  return (
    <ContentTrustProvider
      value={logFile === undefined ? "untrusted" : logContentTrust(header.data)}
    >
      {children}
    </ContentTrustProvider>
  );
};

/** Trust for the selected log's content. */
export const SelectionContentTrustProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  return (
    <LogContentTrustProvider logFile={selectedLogFile}>
      {children}
    </LogContentTrustProvider>
  );
};

/**
 * Trust for views that show the selected sample: the log the sample was
 * read from, which can differ from the selected log while a navigation is
 * mid-flight or a stale selection is restored.
 */
export const SelectedSampleContentTrustProvider: FC<{
  children: ReactNode;
}> = ({ children }) => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const sampleLogFile = useStore(
    (state) => state.log.selectedSampleHandle?.logFile
  );
  return (
    <LogContentTrustProvider logFile={sampleLogFile ?? selectedLogFile}>
      {children}
    </LogContentTrustProvider>
  );
};
