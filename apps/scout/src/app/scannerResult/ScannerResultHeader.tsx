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

import {
  AppConfig,
  ScannerInput,
  Status,
  Transcript,
} from "../../types/api-types";
import { HeadingGrid, HeadingValue } from "../components/HeadingGrid";
import { ScoreValue } from "../components/ScoreValue";
import { TaskName } from "../components/TaskName";
import { projectOrAppAliasedPath } from "../server/useAppConfig";
import {
  isEventInput,
  isEventsInput,
  isMessageInput,
  isMessagesInput,
  isTranscriptInput,
} from "../types";

import styles from "./ScannerResultHeader.module.css";

interface ScannerResultHeaderProps {
  scan?: Status;
  inputData?: ScannerInput;
  appConfig: AppConfig;
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
  appConfig,
}) => {
  const headings = headingsForResult(appConfig, inputData, scan) ?? [];
  if (headings.length === 0) return null;

  // Tabular scores get their own region (same pattern as TranscriptTitle)
  const transcript =
    inputData && isTranscriptInput(inputData) ? inputData.input : undefined;
  const tabularScore = transcript?.score != null && isRecord(transcript.score);

  return (
    <div
      className={clsx(styles.header, tabularScore && styles.headerWithScore)}
    >
      <HeadingGrid
        headings={headings}
        className={tabularScore ? styles.metadataRegion : undefined}
        labelClassName={labelClassName}
        valueClassName={valueClassName}
      />
      {tabularScore && transcript?.score != null && (
        <div className={styles.scoreRegion}>
          <span className={labelClassName}>Score</span>
          <span className={valueClassName}>
            <ScoreValue score={transcript.score} maxRows={5} />
          </span>
        </div>
      )}
    </div>
  );
};

const headingsForResult = (
  appConfig: AppConfig,
  inputData?: ScannerInput,
  status?: Status
): HeadingValue[] | undefined => {
  if (!inputData) return [];
  if (isTranscriptInput(inputData))
    return transcriptHeadings(appConfig, inputData.input, status);
  if (isMessageInput(inputData))
    return messageHeadings(inputData.input, status);
  if (isMessagesInput(inputData)) return messagesHeadings(inputData.input);
  if (isEventInput(inputData)) return eventHeadings(inputData.input);
  if (isEventsInput(inputData)) return eventsHeadings(inputData.input);
  return [];
};

const transcriptHeadings = (
  appConfig: AppConfig,
  transcript: Transcript,
  status?: Status
): HeadingValue[] => {
  // Source info — backwards compat with metadata
  const sourceUri =
    transcript.source_uri ||
    (transcript.metadata?.log as string | undefined) ||
    "";
  let resolvedSourceUrl = sourceUri;
  if (resolvedSourceUrl && resolvedSourceUrl.startsWith("/")) {
    resolvedSourceUrl = `file://${resolvedSourceUrl}`;
  }
  const displaySourceUri = projectOrAppAliasedPath(
    appConfig,
    resolvedSourceUrl
  );

  // Model — backwards compat with metadata
  const transcriptModel =
    transcript.model ||
    (transcript.metadata?.model as string | undefined) ||
    "";

  // Task — backwards compat with metadata
  const taskSet =
    transcript.task_set ||
    (transcript.metadata?.task_name as string | undefined) ||
    "";
  const taskId =
    transcript.task_id || (transcript.metadata?.id as string | undefined) || "";
  const taskRepeat =
    transcript.task_repeat || (transcript.metadata?.epoch as number) || -1;

  const scanningModel = status?.spec.model?.model;

  const headings: HeadingValue[] = [
    {
      label: "Task",
      value: (
        <TaskName taskSet={taskSet} taskId={taskId} taskRepeat={taskRepeat} />
      ),
    },
  ];

  if (displaySourceUri) {
    headings.push({ label: "Source", value: displaySourceUri });
  }

  if (transcript.date) {
    headings.push({
      label: "Date",
      value: formatDateTime(new Date(transcript.date)),
    });
  }

  if (transcript.agent) {
    headings.push({ label: "Agent", value: transcript.agent });
  }

  if (transcriptModel) {
    headings.push({ label: "Model", value: transcriptModel });
  }

  if (scanningModel) {
    headings.push({ label: "Scanning Model", value: scanningModel });
  }

  if (transcript.limit) {
    headings.push({ label: "Limit", value: transcript.limit });
  }

  if (transcript.error) {
    headings.push({ label: "Error", value: transcript.error });
  }

  if (transcript.total_tokens) {
    headings.push({
      label: "Tokens",
      value: formatNumber(transcript.total_tokens),
    });
  }

  if (transcript.total_time) {
    headings.push({
      label: "Time",
      value: formatTime(transcript.total_time),
    });
  }

  if (transcript.message_count) {
    headings.push({
      label: "Messages",
      value: transcript.message_count.toString(),
    });
  }

  // Simple (non-tabular) scores go inline; tabular scores are handled by the parent
  if (transcript.score != null && !isRecord(transcript.score)) {
    headings.push({
      label: "Score",
      value: <ScoreValue score={transcript.score} />,
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
