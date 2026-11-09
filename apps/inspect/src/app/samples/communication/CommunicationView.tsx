import clsx from "clsx";
import { FC, useState } from "react";

import type { CommunicationEvent, Event } from "@tsmono/inspect-common/types";
import {
  communicationAgent,
  communicationLine,
} from "@tsmono/inspect-components/transcript";
import { fmtClock } from "@tsmono/inspect-components/usage";
import {
  ContentText,
  ExpandablePanel,
  NoContentsPanel,
  ToolDropdownButton,
} from "@tsmono/react/components";

import {
  communicationEntries,
  filterEntries,
  filterOptions,
  type CommunicationEntry,
  type CommunicationFilter,
} from "./communicationEntries";
import styles from "./CommunicationView.module.css";

interface CommunicationViewProps {
  /** Scopes the content panels' collapsed state to this sample. */
  id: string;
  events: readonly Event[];
}

/**
 * A sample's agent communication: each send as a message from its sender to
 * its recipients, with its deliveries joined to it, and reads and waits on
 * one line each. Event strings are model or producer text, so they render
 * through the content trust policy as plain text, never Markdown.
 */
export const CommunicationView: FC<CommunicationViewProps> = ({
  id,
  events,
}) => {
  const [filter, setFilter] = useState<CommunicationFilter>({
    agent: null,
    channel: null,
  });
  const entries = communicationEntries(events);
  const options = filterOptions(entries);
  const shown = filterEntries(entries, filter);
  const sendsByRecord = new Map(
    entries.flatMap((entry) =>
      entry.type === "send" && entry.send.record.id
        ? [[entry.send.record.id, entry] as const]
        : []
    )
  );

  return (
    <div className={clsx("text-size-small", styles.view)}>
      <div className={styles.filters}>
        <FilterMenu
          label="Agent"
          values={options.agents}
          selected={filter.agent}
          onSelect={(agent) => setFilter({ ...filter, agent })}
        />
        <FilterMenu
          label="Channel"
          values={options.channels}
          selected={filter.channel}
          onSelect={(channel) => setFilter({ ...filter, channel })}
        />
        <span className={clsx("text-style-secondary", styles.count)}>
          {shown.length === entries.length
            ? `${entries.length} ${entries.length === 1 ? "event" : "events"}`
            : `${shown.length} of ${entries.length} events`}
        </span>
      </div>
      {shown.length === 0 ? (
        <NoContentsPanel text="No communication matches these filters." />
      ) : (
        <ol className={styles.entries}>
          {shown.map((entry) => (
            <li key={entry.key}>
              {entry.type === "send" ? (
                <SendEntry
                  id={`${id}-${entry.key}`}
                  entry={entry}
                  replyTo={
                    entry.send.record.reply_to
                      ? sendsByRecord.get(entry.send.record.reply_to)
                      : undefined
                  }
                />
              ) : (
                <LineEntry event={entry.event} />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};

interface FilterMenuProps {
  label: string;
  values: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}

const FilterMenu: FC<FilterMenuProps> = ({
  label,
  values,
  selected,
  onSelect,
}) => (
  <ToolDropdownButton
    label={`${label}: ${selected ?? "All"}`}
    icon="filter"
    subtle
    dropdownClassName="text-size-smallest"
    items={[
      {
        key: "all",
        label: "All",
        selected: selected === null,
        onClick: () => onSelect(null),
      },
      ...values.map((value) => ({
        key: `value-${value}`,
        label: <ContentText text={value} />,
        selected: value === selected,
        onClick: () => onSelect(value),
      })),
    ]}
  />
);

const SendEntry: FC<{
  id: string;
  entry: Extract<CommunicationEntry, { type: "send" }>;
  replyTo?: Extract<CommunicationEntry, { type: "send" }>;
}> = ({ id, entry, replyTo }) => {
  const { event, send, deliveries } = entry;
  const record = send.record;
  const rejected = send.rejected;
  // An address such as "all" resolves to other names; show both then.
  const toAsWritten =
    record.to.length > 0 &&
    record.to.join(", ") !== record.recipients.join(", ")
      ? record.to.join(", ")
      : null;
  return (
    <article
      className={clsx(styles.send, rejected && styles.sendRefused)}
      aria-label={`${rejected ? "Refused " : ""}${record.kind} from ${event.agent}`}
    >
      <div className={styles.header}>
        <Time event={event} />
        <span className={styles.agent}>
          <ContentText text={communicationAgent(event)} />
        </span>
        {record.recipients.length > 0 ? (
          <span>
            {"→ "}
            <ContentText text={record.recipients.join(", ")} />
          </span>
        ) : null}
        {toAsWritten ? (
          <span className="text-style-secondary">
            {"(to "}
            <ContentText text={toAsWritten} />
            {")"}
          </span>
        ) : null}
        <span className={clsx("text-style-secondary", styles.meta)}>
          <ContentText text={event.channel ?? ""} />
          {" · "}
          <ContentText text={record.kind} />
          {record.id ? (
            <>
              {" · "}
              <ContentText text={record.id} />
            </>
          ) : null}
        </span>
      </div>
      {record.reply_to ? (
        <div className={clsx("text-style-secondary", styles.detail)}>
          {"In reply to "}
          <ContentText text={record.reply_to} />
          {replyTo ? (
            <>
              {" from "}
              <ContentText text={replyTo.event.agent} />
            </>
          ) : null}
        </div>
      ) : null}
      {record.content === null || record.content === undefined ? (
        <div className={clsx("text-style-secondary", styles.detail)}>
          Content not recorded.
        </div>
      ) : record.content.length > 0 ? (
        <ExpandablePanel id={`${id}-content`} collapse={true} lines={8}>
          <div className={styles.content}>
            <ContentText text={record.content} />
          </div>
        </ExpandablePanel>
      ) : null}
      {rejected ? (
        <div className={clsx(styles.detail, styles.refused)}>
          {"Refused ("}
          <ContentText text={rejected.control} />
          {"): "}
          <ContentText text={rejected.reason} />
        </div>
      ) : null}
      {deliveries.map((delivery, index) => (
        <div
          key={delivery.uuid ?? index}
          className={clsx("text-style-secondary", styles.detail)}
        >
          {deliveryText(delivery)}
          {(delivery.delivery?.recipients.length ?? 0) > 0 ? (
            <>
              {" to "}
              <ContentText
                text={delivery.delivery?.recipients.join(", ") ?? ""}
              />
            </>
          ) : null}
          {" · "}
          <Time event={delivery} />
        </div>
      ))}
    </article>
  );
};

const deliveryText = (delivery: CommunicationEvent): string => {
  const seq = delivery.delivery?.seq;
  return seq !== null && seq !== undefined
    ? `Delivered (#${seq})`
    : "Delivered";
};

const LineEntry: FC<{ event: CommunicationEvent }> = ({ event }) => (
  <div className={styles.line}>
    <Time event={event} />
    <span className={styles.agent}>
      <ContentText text={communicationAgent(event)} />
    </span>
    <span>
      {communicationLine(event).map((part, index) => (
        <span
          key={index}
          className={
            part.tone === "refused"
              ? styles.refused
              : part.tone === "secondary"
                ? "text-style-secondary"
                : undefined
          }
        >
          <ContentText text={part.text} />
        </span>
      ))}
    </span>
  </div>
);

const Time: FC<{ event: CommunicationEvent }> = ({ event }) => (
  <time
    className={clsx("text-style-secondary", styles.time)}
    dateTime={event.timestamp}
  >
    {fmtClock(event.timestamp)}
  </time>
);
