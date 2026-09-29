import { FC, ReactNode } from "react";

import { logContentTrust } from "@tsmono/inspect-components/content";
import {
  combineContentTrust,
  ContentTrustProvider,
  type ContentTrust,
} from "@tsmono/react/components";

import { useLogDir } from "../../app_config";
import { useLogHeader, useServerLogContentTrust } from "../../log_data";
import { useStore } from "../../state/store";

/**
 * The content trust of one log, or `undefined` when no log is given. A log
 * is untrusted until its header has been read from the server this session
 * (a cached header may describe an earlier version of the file), and while
 * either that read or the current header says so.
 */
export const useLogFileContentTrust = (
  logFile: string | undefined
): ContentTrust | undefined => {
  const logDir = useLogDir();
  const header = useLogHeader(logDir, logFile, { demand: "passive" });
  const serverTrust = useServerLogContentTrust(logDir, logFile);
  return logFile === undefined
    ? undefined
    : combineContentTrust([logContentTrust(header.data), serverTrust]);
};

/** Trust for the selected log's content (untrusted when none is selected). */
export const SelectionContentTrustProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const logTrust = useLogFileContentTrust(selectedLogFile);
  return (
    <ContentTrustProvider value={logTrust ?? "untrusted"}>
      {children}
    </ContentTrustProvider>
  );
};

/**
 * Trust for views that show the selected sample: the selected log and the
 * selected sample's log. They normally match; while a navigation is
 * mid-flight (or a stale selection is restored) they can differ, and then
 * the content is trusted only if both logs are.
 */
export const SelectedSampleContentTrustProvider: FC<{
  children: ReactNode;
}> = ({ children }) => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const sampleLogFile = useStore(
    (state) => state.log.selectedSampleHandle?.logFile
  );
  const logTrust = useLogFileContentTrust(selectedLogFile);
  const sampleTrust = useLogFileContentTrust(sampleLogFile);
  const trusts = [logTrust, sampleTrust].filter(
    (trust): trust is ContentTrust => trust !== undefined
  );
  return (
    <ContentTrustProvider value={combineContentTrust(trusts)}>
      {children}
    </ContentTrustProvider>
  );
};
