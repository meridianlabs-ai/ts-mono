import { FC, ReactNode } from "react";

import { logContentTrust } from "@tsmono/inspect-components/content";
import {
  combineContentTrust,
  ContentTrustProvider,
  type ContentTrust,
} from "@tsmono/react/components";

import { useLogDir } from "../../app_config";
import {
  sampleSummaryKey,
  useLogHeader,
  useSampleSummariesContentTrust,
} from "../../log_data";
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

/**
 * Trust for each row of the selected log's sample list. A settled row uses
 * the trust read with it from its own log (which differs from the selected
 * log while the previous log's rows are still shown after a switch). A
 * pending-buffer row, which only the selected log produces, uses the
 * selected log's trust.
 *
 * Reading each row's trust with the row (rather than from the separately
 * loaded header) keeps rows from rendering plain and then re-rendering rich
 * as the header arrives, which would remount the content under a click.
 */
export const useSelectedSamplesContentTrust = (): ((
  id: string | number,
  epoch: number
) => ContentTrust) => {
  const logDir = useLogDir();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const logTrust = useLogFileContentTrust(selectedLogFile) ?? "untrusted";
  const rowTrusts = useSampleSummariesContentTrust(logDir, selectedLogFile);
  return (id, epoch) => rowTrusts.get(sampleSummaryKey(id, epoch)) ?? logTrust;
};
