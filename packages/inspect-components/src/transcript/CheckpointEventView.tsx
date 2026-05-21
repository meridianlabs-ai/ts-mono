import { FC, ReactNode } from "react";

import type { CheckpointEvent } from "@tsmono/inspect-common/types";
import { LabeledValue } from "@tsmono/react/components";
import { formatBytes, formatMs } from "@tsmono/util";

import styles from "./CheckpointEventView.module.css";
import { EventRow } from "./event/EventRow";
import { formatTitle } from "./event/utils";
import { TranscriptIcons } from "./icons";
import { EventNode } from "./types";

interface CheckpointEventViewProps {
  eventNode: EventNode<CheckpointEvent>;
  className?: string;
}

const SizeAndDuration: FC<{ size_bytes: number; duration_ms: number }> = ({
  size_bytes,
  duration_ms,
}) => (
  <>
    <LabeledValue label="Size" layout="row">
      {formatBytes(size_bytes)}
    </LabeledValue>
    <LabeledValue label="Duration" layout="row">
      {formatMs(duration_ms)}
    </LabeledValue>
  </>
);

export const CheckpointEventView: FC<CheckpointEventViewProps> = ({
  eventNode,
  className,
}) => {
  const event = eventNode.event;
  const sandboxEntries = Object.entries(event.sandboxes);

  const sections: ReactNode[] = [
    <div key="host" className={styles.section}>
      <div className={styles.sectionTitle}>Host</div>
      <div className={styles.indented}>
        <SizeAndDuration
          size_bytes={event.host.size_bytes}
          duration_ms={event.host.duration_ms}
        />
      </div>
    </div>,
  ];

  const onlySandbox = sandboxEntries.length === 1 ? sandboxEntries[0] : null;
  if (onlySandbox) {
    const [, details] = onlySandbox;
    sections.push(
      <div key="sandbox" className={styles.section}>
        <div className={styles.sectionTitle}>Sandbox</div>
        <div className={styles.indented}>
          <SizeAndDuration
            size_bytes={details.size_bytes}
            duration_ms={details.duration_ms}
          />
        </div>
      </div>
    );
  } else if (sandboxEntries.length > 1) {
    sections.push(
      <div key="sandboxes" className={styles.section}>
        <div className={styles.sectionTitle}>Sandboxes</div>
        <div className={styles.indented}>
          {sandboxEntries.map(([name, details]) => (
            <div key={name} className={styles.section}>
              <div className={styles.sectionTitle}>{name}</div>
              <div className={styles.indented}>
                <SizeAndDuration
                  size_bytes={details.size_bytes}
                  duration_ms={details.duration_ms}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <EventRow
      title={formatTitle(
        `Checkpoint ${event.checkpoint_id}`,
        undefined,
        event.duration_ms / 1000
      )}
      icon={TranscriptIcons.checkpoint}
      className={className}
      below={
        <div className={styles.panel}>
          <LabeledValue label="Size" layout="row">
            {formatBytes(event.size_bytes)}
          </LabeledValue>
          {sections}
        </div>
      }
    />
  );
};
