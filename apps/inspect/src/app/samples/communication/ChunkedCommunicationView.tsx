import { FC } from "react";

import { ErrorPanel, PulsingDots } from "@tsmono/react/components";
import { useMountEffect } from "@tsmono/react/hooks";

import {
  useChunkedCommunicationEvents,
  type ChunkedSample,
} from "../../../log_data";
import { SampleHandle } from "../../types";

import styles from "./ChunkedCommunicationView.module.css";
import { CommunicationView } from "./CommunicationView";

interface ChunkedCommunicationViewProps {
  handle: SampleHandle | undefined;
  chunked: ChunkedSample;
  multiline?: boolean;
  onShown?: () => void;
}

/**
 * The Communication tab of a chunked sample read in windows: its events are
 * read when the tab opens, without downloading the rest of the sample.
 */
export const ChunkedCommunicationView: FC<ChunkedCommunicationViewProps> = ({
  handle,
  chunked,
  multiline,
  onShown,
}) => {
  useMountEffect(() => {
    onShown?.();
  });
  const events = useChunkedCommunicationEvents(handle, chunked);
  if (events.error) {
    return (
      <ErrorPanel
        title="An error occurred while loading communication."
        error={events.error}
      />
    );
  }
  if (events.loading) {
    return (
      <div className={styles.loading}>
        <PulsingDots size="large" text="Loading communication..." />
      </div>
    );
  }
  return <CommunicationView events={events.data} multiline={multiline} />;
};
