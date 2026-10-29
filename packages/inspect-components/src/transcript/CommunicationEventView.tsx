import { FC, ReactNode } from "react";

import type {
  CommunicationEvent,
  JsonValue,
} from "@tsmono/inspect-common/types";
import { JSONPanel } from "@tsmono/react/components";
import { useCollapsedState } from "@tsmono/react/hooks";
import { isRecord } from "@tsmono/util";

import styles from "./CommunicationEventView.module.css";
import { EventRow } from "./event/EventRow";
import { EventNode } from "./types";

interface CommunicationEventViewProps {
  eventNode: EventNode<CommunicationEvent>;
  className?: string;
}

// Keeps a long first line from filling the DOM; CSS ellipsis trims the rest.
const kMaxPreviewLength = 200;

/**
 * Renders a CommunicationEvent as one line (who, which channel, what);
 * clicking the line shows the whole event as JSON. Event strings are model or
 * producer text, so they render as plain text, never Markdown.
 */
export const CommunicationEventView: FC<CommunicationEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const [collapsed, setCollapsed] = useCollapsedState(
    `${eventNode.id}-communication`,
    true
  );
  const toggle = () => setCollapsed(!collapsed);
  const refused = !!event.send?.rejected;

  return (
    <EventRow
      eventNodeId={eventNode.id}
      title={
        // Widens the toggle's hit area for mouse users; the button beside it
        // is the control keyboard users operate.
        <span className={styles.agent} role="presentation" onClick={toggle}>
          {event.agent}
          {event.nested ? " (subagent)" : ""}
        </span>
      }
      icon={refused ? "approvalReject" : "info"}
      iconClassName={refused ? styles.refused : undefined}
      className={className}
      below={collapsed ? undefined : <JSONPanel data={event} />}
    >
      <button
        type="button"
        className={styles.line}
        aria-expanded={!collapsed}
        onClick={toggle}
      >
        {communicationLine(event)}
      </button>
    </EventRow>
  );
};

const communicationLine = (event: CommunicationEvent): ReactNode => {
  const channel = event.channel ?? "";
  switch (event.kind) {
    case "sent":
      return sentLine(event, channel);
    case "delivered": {
      const seq = event.delivery?.seq;
      return (
        <>
          {`→ ${channel}: delivered ${event.record_ids.join(", ")}`}
          {seq !== null && seq !== undefined ? ` (#${seq})` : ""}
          {addressed(event.delivery?.recipients ?? [])}
        </>
      );
    }
    case "read":
      return `← ${channel}: ${readSummary(event)}`;
    case "waited": {
      const wait = event.wait;
      if (!wait) return "waited";
      const on =
        wait.channels.length > 0 ? ` on ${wait.channels.join(", ")}` : "";
      return `waited ${wait.duration.toFixed(1)}s${on}: ${wait.outcome}`;
    }
  }
};

const sentLine = (event: CommunicationEvent, channel: string): ReactNode => {
  const record = event.send?.record;
  if (!record) return `→ ${channel}: sent`;
  const rejected = event.send?.rejected;
  const preview = record.content ? firstLine(record.content) : "";
  return (
    <>
      {`→ ${channel}: ${record.kind}`}
      {record.id ? ` (${record.id})` : ""}
      {addressed(record.to)}
      {rejected ? (
        <>
          {" "}
          <span className={styles.refused}>
            {`refused (${rejected.control})`}
          </span>{" "}
          <span className="text-style-secondary">
            {firstLine(rejected.reason)}
          </span>
        </>
      ) : preview ? (
        <>
          {" "}
          <span className="text-style-secondary">{preview}</span>
        </>
      ) : null}
    </>
  );
};

const addressed = (names: string[]): string =>
  names.length > 0 ? ` to ${names.join(", ")}` : "";

// The shared memory's `data` keys (`listing`, and `lines`/`deleted` on each
// of `files`); a producer without them gets `read` and its record ids.
const readSummary = (event: CommunicationEvent): string => {
  const files = jsonArray(event.data["files"]);
  if (event.data["listing"] === true) {
    const count = files?.length ?? event.record_ids.length;
    return `listed ${count} ${count === 1 ? "file" : "files"}`;
  }
  if (event.record_ids.length === 0) return "read (nothing)";
  const read = `read ${event.record_ids.join(", ")}`;
  const file = files?.length === 1 ? files[0] : undefined;
  if (!isRecord(file)) return read;
  if (file["deleted"] === true) return `${read} (deleted)`;
  const lines = file["lines"];
  return typeof lines === "string" ? `${read} (lines ${lines})` : read;
};

const jsonArray = (value: JsonValue | undefined): JsonValue[] | undefined =>
  Array.isArray(value) ? value : undefined;

const firstLine = (text: string): string => {
  const line = text.trimStart().split("\n", 1)[0] ?? "";
  return line.length > kMaxPreviewLength
    ? `${line.slice(0, kMaxPreviewLength)}…`
    : line;
};
