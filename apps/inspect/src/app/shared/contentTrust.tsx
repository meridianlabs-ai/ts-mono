import { FC, ReactNode } from "react";

import { logContentTrust } from "@tsmono/inspect-components/content";
import { ContentTrustProvider } from "@tsmono/react/components";

import { useLogDir } from "../../app_config";
import { useLogHeader } from "../../log_data";
import {
  useCurrentLogFile,
  useCurrentSampleHandle,
} from "../routing/currentSelection";

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
  const logFile = useCurrentLogFile();
  return (
    <LogContentTrustProvider logFile={logFile}>
      {children}
    </LogContentTrustProvider>
  );
};

/** Trust for views that show the selected sample: the log it was read from. */
export const SelectedSampleContentTrustProvider: FC<{
  children: ReactNode;
}> = ({ children }) => {
  const logFile = useCurrentLogFile();
  const sampleLogFile = useCurrentSampleHandle()?.logFile;
  return (
    <LogContentTrustProvider logFile={sampleLogFile ?? logFile}>
      {children}
    </LogContentTrustProvider>
  );
};
