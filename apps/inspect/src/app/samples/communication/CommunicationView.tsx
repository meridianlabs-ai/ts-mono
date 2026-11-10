import clsx from "clsx";
import { FC, useState } from "react";

import type { CommunicationEvent, Event } from "@tsmono/inspect-common/types";
import {
  communicationAgent,
  communicationLine,
} from "@tsmono/inspect-components/transcript";
import { fmtClock } from "@tsmono/inspect-components/usage";
import { ContentText } from "@tsmono/react/components";
import { useMountEffect } from "@tsmono/react/hooks";

import {
  kGridModeRowHeight,
  kListModeRowHeight,
  SamplesGrid,
} from "../../shared/samples-grid/SamplesGrid";

import { communicationColumns } from "./communicationColumns";
import {
  communicationEntries,
  deliveryNotify,
  waitWokenBy,
  type SendEntry,
} from "./communicationEntries";
import styles from "./CommunicationView.module.css";

interface CommunicationViewProps {
  events: readonly Event[];
  /** Taller rows that show up to three lines of each message. */
  multiline?: boolean;
  /** Called when the tab opens. The grid's find replaces the page's on this
   *  tab, so the owner closes a page find band left open on another tab. */
  onShown?: () => void;
}

// The grid's own header height, so a short list needs no scrolling.
const kHeaderHeight = 25;
// Room for a horizontal scrollbar under the last row.
const kGridSlack = 20;

/**
 * A sample's agent communication as a grid, one row per send (with its
 * deliveries joined to it) and per other event (a read, a wait, a delivery
 * whose send is not in the sample), sortable and filterable by column. The
 * selected row is shown in full below the grid. Event strings are model or
 * producer text, so they render through the content trust policy as plain
 * text, never Markdown.
 */
export const CommunicationView: FC<CommunicationViewProps> = ({
  events,
  multiline = false,
  onShown,
}) => {
  useMountEffect(() => {
    onShown?.();
  });
  const entries = communicationEntries(events);
  const [selectedKey, setSelectedKey] = useState<string>();
  const selected = entries.find((entry) => entry.key === selectedKey);
  const select = (entry: { key: string }) => setSelectedKey(entry.key);
  const rowHeight = multiline ? kListModeRowHeight : kGridModeRowHeight;
  const gridHeight = kHeaderHeight + entries.length * rowHeight + kGridSlack;
  return (
    <div className={clsx("text-size-small", styles.view)}>
      <div
        className={styles.grid}
        style={{ height: `min(60vh, ${gridHeight}px)` }}
      >
        <SamplesGrid
          rowData={entries}
          columnDefs={communicationColumns(multiline)}
          multiline={multiline}
          getRowId={(entry) => entry.key}
          selectedRowId={selectedKey}
          onRowSelect={select}
          onRowOpen={select}
          ariaLabel="Communication"
          autoFocus={false}
          findable
        />
      </div>
      <section aria-label="Selected row">
        {selected === undefined ? (
          <div className="text-style-secondary">
            Select a row to show it in full.
          </div>
        ) : selected.type === "send" ? (
          <SendRow entry={selected} />
        ) : (
          <LineEntry event={selected.event} />
        )}
      </section>
    </div>
  );
};

const SendRow: FC<{ entry: SendEntry }> = ({ entry }) => {
  const { event, send, deliveries, replyTo } = entry;
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
        <div className={styles.content}>
          <ContentText text={record.content} />
        </div>
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
          <Notified delivery={delivery} />
          {" · "}
          <Time event={delivery} />
        </div>
      ))}
    </article>
  );
};

// A shared-memory write is addressed to no one but is news to members that
// had not seen it; a message's notified members are its recipients.
const Notified: FC<{ delivery: CommunicationEvent }> = ({ delivery }) => {
  const notify = deliveryNotify(delivery).join(", ");
  if (!notify || notify === delivery.delivery?.recipients.join(", ")) {
    return null;
  }
  return (
    <>
      {" · notified "}
      <ContentText text={notify} />
    </>
  );
};

const deliveryText = (delivery: CommunicationEvent): string => {
  const seq = delivery.delivery?.seq;
  return seq !== null && seq !== undefined
    ? `Delivered (#${seq})`
    : "Delivered";
};

const LineEntry: FC<{ event: CommunicationEvent }> = ({ event }) => {
  const wokenBy = event.kind === "waited" ? waitWokenBy(event) : [];
  return (
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
      {wokenBy.length > 0 ? (
        <span className="text-style-secondary">
          {`woken by ${wokenBy.map((seq) => `#${seq}`).join(", ")}`}
        </span>
      ) : null}
    </div>
  );
};

const Time: FC<{ event: CommunicationEvent }> = ({ event }) => (
  <time
    className={clsx("text-style-secondary", styles.time)}
    dateTime={event.timestamp}
  >
    {fmtClock(event.timestamp)}
  </time>
);
