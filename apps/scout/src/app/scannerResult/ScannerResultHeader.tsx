import clsx from "clsx";
import { FC } from "react";

import type { ChatMessage, Event } from "@tsmono/inspect-common/types";
import type { EventType } from "@tsmono/inspect-components/transcript";
import {
  formatDateTime,
  formatNumber,
  formatTime,
  isRecord,
} from "@tsmono/util";

import { AppConfig, ScannerInput, Status } from "../../types/api-types";
import { HeadingGrid, HeadingValue } from "../components/HeadingGrid";
import { TaskName } from "../components/TaskName";
import { projectOrAppAliasedPath } from "../server/useAppConfig";
import {
  isEventInput,
  isEventsInput,
  isMessageInput,
  isMessagesInput,
  isTranscriptInput,
  ScanResultData,
} from "../types";

import styles from "./ScannerResultHeader.module.css";
import { ScoreColumn } from "./ScoreColumn";
import { SourcePath } from "./SourcePath";

interface ScannerResultHeaderProps {
  scan?: Status;
  inputData?: ScannerInput;
  resultData?: ScanResultData;
  appConfig: AppConfig;
  onShowAllScores?: () => void;
}

const labelClassName = clsx(
  "text-style-label",
  "text-size-smallestest",
  "text-style-secondary"
);
const valueClassName = clsx("text-size-small");

export const ScannerResultHeader: FC<ScannerResultHeaderProps> = ({
  scan,
  inputData,
  resultData,
  appConfig,
  onShowAllScores,
}) => {
  const headings =
    headingsForResult(appConfig, inputData, resultData, scan) ?? [];
  if (headings.length === 0) return null;

  const score = resultData?.transcriptScore;
  const hasScore = score != null;
  const scoreGridColumns = hasScore
    ? isRecord(score)
      ? "minmax(0,1fr) minmax(260px, 38%)"
      : "minmax(0,1fr) auto"
    : undefined;

  return (
    <div
      className={clsx(styles.header, hasScore && styles.headerWithScore)}
      style={
        scoreGridColumns ? { gridTemplateColumns: scoreGridColumns } : undefined
      }
    >
      <HeadingGrid
        headings={headings}
        className={hasScore ? styles.metadataRegion : undefined}
        labelClassName={labelClassName}
        valueClassName={valueClassName}
      />
      {hasScore && (
        <ScoreColumn
          score={score}
          labelClassName={labelClassName}
          valueClassName={valueClassName}
          onShowAllScores={onShowAllScores}
        />
      )}
    </div>
  );
};

const headingsForResult = (
  appConfig: AppConfig,
  inputData?: ScannerInput,
  resultData?: ScanResultData,
  status?: Status
): HeadingValue[] | undefined => {
  if (!inputData) return [];
  if (isTranscriptInput(inputData))
    return transcriptHeadings(appConfig, resultData, status);
  if (isMessageInput(inputData))
    return messageHeadings(inputData.input, status);
  if (isMessagesInput(inputData)) return messagesHeadings(inputData.input);
  if (isEventInput(inputData)) return eventHeadings(inputData.input);
  if (isEventsInput(inputData)) return eventsHeadings(inputData.input);
  return [];
};

const transcriptHeadings = (
  appConfig: AppConfig,
  resultData?: ScanResultData,
  status?: Status
): HeadingValue[] => {
  if (!resultData) return [];

  // Source info
  const sourceUri = resultData.transcriptSourceUri ?? "";
  let resolvedSourceUrl = sourceUri;
  if (resolvedSourceUrl && resolvedSourceUrl.startsWith("/")) {
    resolvedSourceUrl = `file://${resolvedSourceUrl}`;
  }
  const displaySourceUri = projectOrAppAliasedPath(
    appConfig,
    resolvedSourceUrl
  );

  const transcriptModel = resultData.transcriptModel ?? "";
  const scanningModel = status?.spec.model?.model;

  const headings: HeadingValue[] = [
    {
      label: "Task",
      value: (
        <TaskName
          taskSet={resultData.transcriptTaskSet}
          taskId={resultData.transcriptTaskId}
          taskRepeat={resultData.transcriptTaskRepeat}
        />
      ),
    },
  ];

  if (displaySourceUri) {
    headings.push({
      label: "Source",
      value: <SourcePath uri={displaySourceUri} />,
    });
  }

  if (resultData.transcriptDate) {
    headings.push({
      label: "Date",
      value: formatDateTime(new Date(resultData.transcriptDate)),
    });
  }

  if (resultData.transcriptAgent) {
    headings.push({
      label: "Agent",
      value: (
        <span style={{ fontFamily: "var(--bs-font-monospace)" }}>
          {resultData.transcriptAgent}
        </span>
      ),
    });
  }

  if (transcriptModel) {
    headings.push({
      label: "Model",
      value: (
        <span style={{ fontFamily: "var(--bs-font-monospace)" }}>
          {transcriptModel}
        </span>
      ),
    });
  }

  if (scanningModel) {
    headings.push({
      label: "Scanning Model",
      value: (
        <span style={{ fontFamily: "var(--bs-font-monospace)" }}>
          {scanningModel}
        </span>
      ),
    });
  }

  if (resultData.transcriptLimit) {
    headings.push({ label: "Limit", value: resultData.transcriptLimit });
  }

  if (resultData.transcriptError) {
    headings.push({ label: "Error", value: resultData.transcriptError });
  }

  if (resultData.transcriptTotalTokens) {
    headings.push({
      label: "Tokens",
      value: formatNumber(resultData.transcriptTotalTokens),
    });
  }

  if (resultData.transcriptTotalTime) {
    headings.push({
      label: "Time",
      value: formatTime(resultData.transcriptTotalTime),
    });
  }

  if (resultData.transcriptMessageCount) {
    headings.push({
      label: "Messages",
      value: resultData.transcriptMessageCount.toString(),
    });
  }

  return headings;
};

const messageHeadings = (
  message: ChatMessage,
  status?: Status
): HeadingValue[] => {
  const headings: HeadingValue[] = [{ label: "Message ID", value: message.id }];

  if (message.role === "assistant") {
    headings.push({ label: "Model", value: message.model });
    headings.push({
      label: "Tool Calls",
      value: ((message.tool_calls as []) || []).length,
    });
  } else {
    headings.push({ label: "Role", value: message.role });
  }

  if (status?.spec.model?.model) {
    headings.push({
      label: "Scanning Model",
      value: status.spec.model.model,
    });
  }

  return headings;
};

const messagesHeadings = (messages: ChatMessage[]): HeadingValue[] => [
  { label: "Message Count", value: messages.length },
];

const eventHeadings = (event: EventType): HeadingValue[] => [
  { label: "Event Type", value: event.event },
  {
    label: "Timestamp",
    value: event.timestamp
      ? new Date(event.timestamp).toLocaleString()
      : undefined,
  },
];

const eventsHeadings = (events: Event[]): HeadingValue[] => [
  { label: "Event Count", value: events.length },
];
