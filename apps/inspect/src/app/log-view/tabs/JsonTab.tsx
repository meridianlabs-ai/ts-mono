import { FC, useMemo } from "react";

import { JSONPanel, ToolButton } from "@tsmono/react/components";
import { useCopyToClipboard } from "@tsmono/react/hooks";
import { filename } from "@tsmono/util";

import { LogHeader } from "../../../client/api/types";
import { DownloadPanel } from "../../../components/DownloadPanel";
import { kLogViewJsonTabId } from "../../../constants";
import { useStore } from "../../../state/store";
import { ApplicationIcons } from "../../appearance/icons";

import styles from "./JsonTab.module.css";

const kJsonMaxSize = 10000000;

// Individual hook for JSON tab
export const useJsonTabConfig = (logDetails: LogHeader | undefined) => {
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const selectedTab = useStore((state) => state.app.tabs.workspace);

  return useMemo(() => {
    // Show the log's own fields, not the client-derived sample facts.
    const {
      sampleCount: _count,
      sampleErrorCount: _errors,
      sampleLimits: _limits,
      ...header
    } = logDetails ?? {};
    const json = JSON.stringify(header, null, 2);

    return {
      id: kLogViewJsonTabId,
      label: "JSON",
      scrollable: true,
      component: JsonTab,
      componentProps: {
        logFile: selectedLogFile,
        json,
        selected: selectedTab === kLogViewJsonTabId,
      },
      tools: () => [<CopyJsonButton key="copy-json" json={json} />],
    };
  }, [selectedLogFile, logDetails, selectedTab]);
};

/**
 * Copies the tab's JSON from props. The copy is bound to this element by
 * React, not discovered by a document-wide selector, so log-authored markup
 * can never become a copy trigger.
 */
export const CopyJsonButton: FC<{ json: string }> = ({ json }) => {
  const { copied, copy } = useCopyToClipboard();
  return (
    <ToolButton
      label={copied ? "Copied!" : "Copy JSON"}
      icon={copied ? ApplicationIcons.confirm : ApplicationIcons.copy}
      subtle
      disabled={copied}
      onClick={() => copy(json)}
    />
  );
};

interface JsonTabProps {
  logFile?: string;
  selected: boolean;
  json: string;
}

/**
 * Renders JSON tab
 */
export const JsonTab: FC<JsonTabProps> = ({ logFile, json }) => {
  const downloadFiles = useStore((state) => state.capabilities.downloadFiles);
  if (logFile && json.length > kJsonMaxSize && downloadFiles) {
    // This JSON file is so large we can't really productively render it
    // we should instead just provide a DL link
    const file = `${filename(logFile)}.json`;
    return (
      <div className={styles.jsonTab}>
        <DownloadPanel
          message="The JSON for this log file is too large to render."
          buttonLabel="Download JSON File"
          fileName={file}
          fileContents={json}
        />
      </div>
    );
  } else {
    return (
      <div className={styles.jsonTab}>
        <JSONPanel id="task-json-contents" json={json} simple={true} />
      </div>
    );
  }
};
