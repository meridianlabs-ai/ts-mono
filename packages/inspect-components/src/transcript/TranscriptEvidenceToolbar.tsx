import { FC, useMemo, useState } from "react";

import {
  eventsToHtmlDocument,
  eventsToMarkdown,
  eventsToStr,
} from "./eventText";
import styles from "./TranscriptEvidenceToolbar.module.css";
import type { EventType } from "./types";

interface TranscriptEvidenceToolbarProps {
  active: boolean;
  events: EventType[];
  onActivate: () => void;
  onCancel: () => void;
  onClear: () => void;
}

type ExportFormat = "markdown" | "text";

const exportDetails: Record<
  ExportFormat,
  {
    extension: string;
    mime: string;
    serialize: (events: EventType[]) => string;
  }
> = {
  markdown: {
    extension: "md",
    mime: "text/markdown;charset=utf-8",
    serialize: eventsToMarkdown,
  },
  text: {
    extension: "txt",
    mime: "text/plain;charset=utf-8",
    serialize: eventsToStr,
  },
};

export const TranscriptEvidenceToolbar: FC<TranscriptEvidenceToolbarProps> = ({
  active,
  events,
  onActivate,
  onCancel,
  onClear,
}) => {
  const [copied, setCopied] = useState<ExportFormat | null>(null);
  const serialized = useMemo(
    () => ({
      markdown: eventsToMarkdown(events),
      text: eventsToStr(events),
    }),
    [events]
  );
  const disabled = events.length === 0;

  const copy = async (format: ExportFormat) => {
    await navigator.clipboard.writeText(serialized[format]);
    setCopied(format);
    window.setTimeout(() => setCopied(null), 1250);
  };

  const download = (format: ExportFormat) => {
    const details = exportDetails[format];
    const blob = new Blob([serialized[format]], { type: details.mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inspect-transcript-evidence.${details.extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    const blob = new Blob([eventsToHtmlDocument(events)], {
      type: "text/html;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, "_blank");
    if (!printWindow) {
      URL.revokeObjectURL(url);
      return;
    }
    printWindow.opener = null;
    printWindow.addEventListener(
      "load",
      () => {
        printWindow.print();
        printWindow.addEventListener(
          "afterprint",
          () => {
            printWindow.close();
            URL.revokeObjectURL(url);
          },
          { once: true }
        );
      },
      { once: true }
    );
  };

  if (!active) {
    return (
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.button}
          onClick={onActivate}
          aria-label="Select transcript evidence"
        >
          <i className="bi bi-check2-square" aria-hidden="true" />
          Select evidence
        </button>
      </div>
    );
  }

  return (
    <div className={styles.toolbar} aria-label="Transcript evidence export">
      <span className={styles.count}>
        {events.length === 1
          ? "1 event selected"
          : `${events.length} events selected`}
      </span>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={() => {
          copy("markdown").catch(() => setCopied(null));
        }}
      >
        <i
          className={copied === "markdown" ? "bi bi-check2" : "bi bi-clipboard"}
          aria-hidden="true"
        />
        {copied === "markdown" ? "Copied" : "Copy Markdown"}
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={() => {
          copy("text").catch(() => setCopied(null));
        }}
      >
        <i
          className={copied === "text" ? "bi bi-check2" : "bi bi-clipboard"}
          aria-hidden="true"
        />
        {copied === "text" ? "Copied" : "Copy text"}
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={() => download("markdown")}
      >
        <i className="bi bi-download" aria-hidden="true" />
        Download Markdown
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={() => download("text")}
      >
        <i className="bi bi-download" aria-hidden="true" />
        Download text
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={printPdf}
      >
        <i className="bi bi-printer" aria-hidden="true" />
        Print / Save PDF
      </button>
      <button
        type="button"
        className={styles.button}
        disabled={disabled}
        onClick={onClear}
      >
        Clear
      </button>
      <button type="button" className={styles.button} onClick={onCancel}>
        Done
      </button>
    </div>
  );
};
