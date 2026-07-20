import { useCallback } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import {
  parseTranscriptParams,
  transcriptEventDetailRoute,
  transcriptRoute,
} from "../../../router/url";

/**
 * Converts a hash-router relative URL to a full absolute URL.
 */
const toFullUrl = (route: string): string => {
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

  // TODO: seems like these "full" urls don't work in vscode
  // is this a foot gun? an existing bug?
  const getFullEventUrl = useCallback(
    (eventId: string): string | undefined => {
      const route = getEventUrl(eventId);
      return route ? toFullUrl(route) : undefined;
    },
    [getEventUrl]
  );

  const getFullMessageUrl = useCallback(
    (messageId: string): string | undefined => {
      const route = getMessageUrl(messageId);
      return route ? toFullUrl(route) : undefined;
    },
    [getMessageUrl]
  );

  const getFullEventMessageUrl = useCallback(
    (messageId: string): string | undefined => {
      const route = getEventMessageUrl(messageId);
      return route ? toFullUrl(route) : undefined;
    },
    [getEventMessageUrl]
  );

  // Hash-route href for the focus-mode entry control. Relative `#…` so a
  // ctrl/cmd-click or middle-click opens the focus page in a new tab.
  const getEventFocusUrl = useCallback(
    (eventId: string, selectedTab?: string): string | undefined => {
      if (!transcriptsDir || !transcriptId) return undefined;
      const base = `#${transcriptEventDetailRoute(transcriptsDir, transcriptId, eventId)}`;
      return selectedTab
        ? `${base}&tab=${encodeURIComponent(selectedTab)}`
        : base;
    },
    [transcriptsDir, transcriptId]
  );

  const navigate = useNavigate();
  const location = useLocation();

  // focus-mode entry: plain click navigates in-window; modified clicks use the href
  const onOpenEventFocus = useCallback(
    (focusRoute: string): void => {
      // Idempotent: a double-click / f-key repeat must not push the same focus
      // URL twice (the first Back would then be a same-URL no-op).
      if (focusRoute === `${location.pathname}${location.search}`) return;
      const result = navigate(focusRoute);
      if (result instanceof Promise) result.catch(() => undefined);
    },
    [navigate, location.pathname, location.search]
  );

  return {
    getEventUrl,
    getMessageUrl,
    getEventMessageUrl,
    getFullEventUrl,
    getFullMessageUrl,
    getFullEventMessageUrl,
    getEventFocusUrl,
    onOpenEventFocus,
  };
};
