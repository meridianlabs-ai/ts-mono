import { FC, ReactNode } from "react";

import { logContentTrust } from "@tsmono/inspect-components/content";
import {
  combineContentTrust,
  ContentTrustProvider,
  type ContentTrust,
} from "@tsmono/react/components";

import { useLogDir } from "../../app_config";
import { useLogHeader, useSampleSummariesContentTrust } from "../../log_data";
import { useStore } from "../../state/store";

/**
 * The content trust of one log, or `undefined` when no log is given. A log
 * whose header hasn't loaded is untrusted until it does.
 */
export const useLogFileContentTrust = (
  logFile: string | undefined
): ContentTrust | undefined => {
  const logDir = useLogDir();
  const header = useLogHeader(logDir, logFile, { demand: "passive" });
  return logFile === undefined ? undefined : logContentTrust(header.data);
};

/**
 * Trust for everything the current selection can put on screen: the
 * selected log and the selected sample's log. They normally match; while a
 * navigation is mid-flight they can briefly differ, and then the content is
 * trusted only if both logs are.
 */
export const SelectionContentTrustProvider: FC<{ children: ReactNode }> = ({
  children,
}) => {
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

/**
 * Trust for the selected log's sample list: the selected log and every log
 * the listed rows actually came from (which differ while the previous log's
 * rows are still shown after a switch).
 */
export const useSelectedSamplesContentTrust = (): ContentTrust => {
  const logDir = useLogDir();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const logTrust = useLogFileContentTrust(selectedLogFile);
  const rowTrusts = useSampleSummariesContentTrust(logDir, selectedLogFile);
  return combineContentTrust(
    logTrust === undefined ? [] : [logTrust, ...rowTrusts]
  );
};
