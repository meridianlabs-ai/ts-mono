import { useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { parseTranscriptParams, transcriptRoute } from "../../../router/url";

/**
 * Converts a hash-router route to an absolute shareable URL. Passed as
 * `toShareUrl` to shared components that surface copyable links.
 */
export const toFullUrl = (route: string): string => {
  return `${window.location.origin}${window.location.pathname}#${route}`;
};

/**
 * Hook for generating deep link URLs to specific events or messages
 * within a transcript.
 *
 * @returns Functions to generate URLs for event and message deep links
 */
export const useTranscriptNavigation = () => {
  const params = useParams<{ transcriptsDir: string; transcriptId: string }>();
  const { transcriptsDir, transcriptId } = parseTranscriptParams(params);
  const [searchParams] = useSearchParams();

  const getEventUrl = useCallback(
    (eventId: string, selectedKey?: string): string | undefined => {
      if (!transcriptsDir || !transcriptId) return undefined;
      const newParams = new URLSearchParams(searchParams);
      newParams.set("tab", "transcript-events");
      newParams.set("event", eventId);
      newParams.delete("message");
      if (selectedKey !== undefined) {
        newParams.set("selected", selectedKey);
      }
      return transcriptRoute(transcriptsDir, transcriptId, newParams);
    },
    [transcriptsDir, transcriptId, searchParams]
  );

  const getMessageUrl = useCallback(
    (messageId: string): string | undefined => {
      if (!transcriptsDir || !transcriptId) return undefined;
      const newParams = new URLSearchParams(searchParams);
      newParams.set("tab", "transcript-messages");
      newParams.set("message", messageId);
      newParams.delete("event");
      return transcriptRoute(transcriptsDir, transcriptId, newParams);
    },
    [transcriptsDir, transcriptId, searchParams]
  );

  const getEventMessageUrl = useCallback(
    (messageId: string): string | undefined => {
      if (!transcriptsDir || !transcriptId) return undefined;
      const newParams = new URLSearchParams(searchParams);
      newParams.set("tab", "transcript-events");
      newParams.set("message", messageId);
      newParams.delete("event");
      newParams.delete("selected");
      return transcriptRoute(transcriptsDir, transcriptId, newParams);
    },
    [transcriptsDir, transcriptId, searchParams]
  );

  return {
    getEventUrl,
    getMessageUrl,
    getEventMessageUrl,
  };
};
