import clsx from "clsx";
import { FC, useRef } from "react";
import { useLocation } from "react-router";

import { ContentCode, ContentTrustProvider } from "@tsmono/react/components";
import { usePrismHighlight } from "@tsmono/react/hooks";
import { dirname } from "@tsmono/util";

import { useLogDir } from "../../app_config";
import { useLogsSync } from "../../log_data";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";
import { logsUrl, samplesUrl, useLogOrSampleRouteParams } from "../routing/url";

import styles from "./FlowPanel.module.css";
import { useFlowQuery } from "./hooks";

// The flow file belongs to the log directory, not to any log, and isn't model
// output; the viewer-wide trust setting still caps it.
export const FlowPanel: FC = () => (
  <ContentTrustProvider value="trusted">
    <FlowPanelContent />
  </ContentTrustProvider>
);

const FlowPanelContent: FC = () => {
  const location = useLocation();
  const isSamplesRoute = location.pathname.startsWith("/samples/");

  // Get the path from route params (handles both logs and samples context)
  const { logPath: currentPath } = useLogOrSampleRouteParams();
  const flowDir = dirname(currentPath || "");
  const logDir = useLogDir();

  // The navbar renders from the listing collections; subscribe so they sync.
  useLogsSync(logDir, flowDir);

  const flow = useFlowQuery(flowDir || "").data;

  // Syntax highlighting
  const codeContainerRef = useRef<HTMLDivElement>(null);
  usePrismHighlight(codeContainerRef, flow?.length || 0);

  // Use the appropriate navigation function based on context
  const fnNavigationUrl = isSamplesRoute ? samplesUrl : logsUrl;

  return (
    <div className={clsx(styles.container)}>
      <ApplicationNavbar
        currentPath={currentPath}
        fnNavigationUrl={fnNavigationUrl}
      />
      <div ref={codeContainerRef} className={clsx(styles.panel)}>
        <pre className={clsx(styles.code)}>
          <ContentCode className={clsx("language-yml")} text={flow ?? ""} />
        </pre>
      </div>
    </div>
  );
};
