import { skipToken } from "@tanstack/react-query";
import { FC, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import {
  FocusTurnView,
  useEventNodes,
  useFocusTurnNavigation,
} from "@tsmono/inspect-components/transcript";
import {
  ErrorPanel,
  LoadingBar,
  NoContentsPanel,
} from "@tsmono/react/components";
import { useRequiredParams } from "@tsmono/react/hooks";

import { useAppConfig } from "../server/useAppConfig";
import { useTranscript } from "../server/useTranscript";

/**
 * Standalone single-event page (open-in-new-tab from a transcript event).
 * Renders the focused event (and its turn's tool calls) fully expanded, with
 * the transcript's own renderer but without the list's card/gutter chrome.
 * URL: /transcripts/<transcriptsDir>/<transcriptId>/event?event=<eventId>
 */
export const TranscriptEventPanel: FC = () => {
  const { transcriptId } = useRequiredParams("transcriptId");
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = searchParams.get("event");

  const config = useAppConfig();
  const {
    loading,
    data: transcript,
    error,
  } = useTranscript(
    config.transcripts
      ? { location: config.transcripts.dir, id: transcriptId }
      : skipToken
  );

  const { eventNodes } = useEventNodes(transcript?.events ?? [], false);
  const setParam = useCallback(
    (key: string, value: string) =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set(key, value);
          return params;
        },
        { replace: true }
      ),
    [setSearchParams]
  );
  const nav = useFocusTurnNavigation(
    eventNodes,
    eventId,
    searchParams.get("tab") ?? "Summary",
    setParam
  );

  return (
    <>
      <LoadingBar loading={loading} />
      {error && <ErrorPanel title="Error Loading Transcript" error={error} />}
      {!error && transcript && nav.slice.length === 0 && (
        <NoContentsPanel text="Event not found in this transcript." />
      )}
      {!error && transcript && nav.slice.length > 0 && (
        <FocusTurnView nav={nav} eventId={eventId} />
      )}
    </>
  );
};
