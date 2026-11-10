import clsx from "clsx";

import {
  communicationAgent,
  communicationLine,
} from "@tsmono/inspect-components/transcript";
import { fmtClock } from "@tsmono/inspect-components/usage";
import { ContentText } from "@tsmono/react/components";

import type { ExtendedColumnDef } from "../../shared/data-grid/columnTypes";
import { comparators } from "../../shared/gridComparators";

import { entryChannels, type CommunicationEntry } from "./communicationEntries";
import styles from "./CommunicationView.module.css";

type CommunicationColumn = ExtendedColumnDef<CommunicationEntry>;

// A cell shows one line; the selected row's panel shows the rest. The cap
// keeps megabytes of content out of the DOM, and the ellipsis marks it.
const kPreviewLength = 300;

const preview = (text: string): string =>
  text.length > kPreviewLength ? `${text.slice(0, kPreviewLength)}…` : text;

const names = (values: readonly string[]): string => values.join(", ");

const deliveredTo = (entry: CommunicationEntry): string =>
  entry.type === "send"
    ? entry.deliveries
        .map((delivery) => {
          const seq = delivery.delivery?.seq;
          const to = names(delivery.delivery?.recipients ?? []);
          return seq !== null && seq !== undefined
            ? `${to} (#${seq})`.trim()
            : to;
        })
        .join("; ")
    : "";

const recordId = (entry: CommunicationEntry): string =>
  entry.type === "send" && entry.send.record.id
    ? entry.send.record.id
    : names(entry.event.record_ids);

const recipients = (entry: CommunicationEntry): string =>
  entry.type === "send"
    ? names(entry.send.record.recipients)
    : names(entry.event.delivery?.recipients ?? []);

const replyTo = (entry: CommunicationEntry): string => {
  if (entry.type !== "send") return "";
  const id = entry.send.record.reply_to;
  if (!id) return "";
  return entry.replyTo ? `${id} from ${entry.replyTo.event.agent}` : id;
};

const status = (entry: CommunicationEntry): string => {
  if (entry.type === "send") {
    const rejected = entry.send.rejected;
    if (rejected) return `Refused (${rejected.control}): ${rejected.reason}`;
    return entry.deliveries.length > 0 ? "Delivered" : "Sent";
  }
  return entry.event.wait?.outcome ?? "";
};

const content = (entry: CommunicationEntry): string =>
  entry.type === "send"
    ? (entry.send.record.content ?? "")
    : communicationLine(entry.event)
        .map((part) => part.text)
        .join("");

const isRefused = (entry: CommunicationEntry): boolean =>
  entry.type === "send" && !!entry.send.rejected;

const textColumn = (
  id: string,
  header: string,
  value: (entry: CommunicationEntry) => string,
  size: number,
  extra: Partial<CommunicationColumn> = {}
): CommunicationColumn => ({
  id,
  header,
  size,
  minSize: 50,
  // An absent attribute is undefined, not "", so the shared "Is blank"
  // filter (a null test) finds it; cells show it as empty text.
  accessorFn: (entry) => value(entry) || undefined,
  cell: ({ getValue }) => (
    <div>
      <ContentText text={getValue<string | undefined>() ?? ""} />
    </div>
  ),
  meta: { filterable: true, filterType: "string" },
  ...extra,
});

/**
 * The Communication grid's columns, one per attribute a row can have. Every
 * value is log text, so cells render through the content trust policy.
 */
export const communicationColumns: CommunicationColumn[] = [
  {
    id: "time",
    header: "Time",
    size: 100,
    minSize: 60,
    accessorFn: (entry) => entry.event.timestamp,
    cell: ({ getValue }) => <div>{fmtClock(getValue<string>())}</div>,
    meta: {
      filterable: true,
      filterType: "datetime",
      sortComparator: (a, b) => comparators.date(a, b),
    },
  },
  textColumn("agent", "Agent", (entry) => communicationAgent(entry.event), 120),
  textColumn("event", "Event", (entry) => entry.event.kind, 80),
  textColumn("channel", "Channel", (entry) => names(entryChannels(entry)), 120),
  textColumn(
    "kind",
    "Kind",
    (entry) => (entry.type === "send" ? entry.send.record.kind : ""),
    80
  ),
  textColumn("id", "Id", recordId, 70),
  textColumn("to", "To", recipients, 110),
  textColumn("replyTo", "Reply to", replyTo, 110),
  textColumn("delivered", "Delivered to", deliveredTo, 110),
  textColumn("status", "Status", status, 150, {
    cell: ({ getValue, row }) => (
      <div className={clsx(isRefused(row.original) && styles.refused)}>
        <ContentText text={getValue<string | undefined>() ?? ""} />
      </div>
    ),
  }),
  textColumn("content", "Content", content, 260, {
    minSize: 120,
    flex: 1,
    cell: ({ getValue }) => (
      <div>
        <ContentText text={preview(getValue<string | undefined>() ?? "")} />
      </div>
    ),
  }),
];
