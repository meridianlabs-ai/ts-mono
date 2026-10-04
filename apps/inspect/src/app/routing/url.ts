import { useCallback, useMemo } from "react";
import { useLocation } from "react-router";

import { directoryRelativeUrl, encodePathParts } from "@tsmono/util";

import {
  kSampleEventTabId,
  kSampleMessagesTabId,
  kSampleTranscriptTabId,
} from "../../constants";

import { useCurrentSampleHandle } from "./currentSelection";
import { decodeUrlParam, useLogOrSampleRouteParams } from "./routeParams";

export {
  decodeUrlParam,
  parseLogRouteParams,
  parseSamplesRouteParams,
  useDecodedParams,
  useLogOrSampleRouteParams,
  useLogRouteParams,
  useSamplesRouteParams,
} from "./routeParams";
export type { LogOrSampleRouteParams, LogRouteParams } from "./routeParams";

export const kLogsRoutUrlPattern = "/logs";
export const kLogRouteUrlPattern = "/logs/*";
export const kSamplesRouteUrlPattern = "/samples";
export const kTasksRouteUrlPattern = "/tasks";
export const kTaskRouteUrlPattern = "/tasks/*";

export type RoutePrefix = "/logs" | "/tasks";

/**
 * Hook that returns the current route prefix based on the URL.
 * Returns "/tasks" when under /tasks/*, "/logs" otherwise.
 */
export const useRoutePrefix = (): RoutePrefix => {
  const location = useLocation();
  return location.pathname.startsWith("/tasks") ? "/tasks" : "/logs";
};

export const baseUrl = (
  logPath: string,
  sampleId?: string | number,
  sampleEpoch?: string | number,
  prefix: RoutePrefix = "/logs"
) => {
  if (sampleId !== undefined && sampleEpoch !== undefined) {
    return logSamplesUrl(logPath, sampleId, sampleEpoch, undefined, prefix);
  } else {
    return logsUrl(logPath, undefined, undefined, prefix);
  }
};

export type SampleUrlBuilder = (
  logPath: string,
  sampleId?: string | number,
  sampleEpoch?: string | number,
  sampleTabId?: string
) => string;

export const useSampleUrlBuilder = () => {
  const location = useLocation();
  // Memoize on pathname so the returned builder keeps a stable identity across
  // renders (e.g. streaming polls). Downstream memos (SampleDisplay's
  // `messageOptions`, TranscriptPanel's event-url chain) key on this builder,
  // so an unstable identity would defeat their memoization.
  return useCallback(
    (
      logPath: string,
      sampleId?: string | number,
      sampleEpoch?: string | number,
      sampleTabId?: string
    ) => {
      const prefix: RoutePrefix = location.pathname.startsWith("/tasks")
        ? "/tasks"
        : "/logs";
      if (
        sampleId &&
        sampleEpoch &&
        location.pathname.startsWith("/samples/")
      ) {
        return samplesSampleUrl(logPath, sampleId, sampleEpoch, sampleTabId);
      } else {
        return logSamplesUrl(
          logPath,
          sampleId,
          sampleEpoch,
          sampleTabId,
          prefix
        );
      }
    },
    [location.pathname]
  );
};

export const logSamplesUrl = (
  logPath: string,
  sampleId?: string | number,
  sampleEpoch?: string | number,
  sampleTabId?: string,
  prefix: RoutePrefix = "/logs"
) => {
  // Ensure logPath is decoded before encoding for URL construction
  const decodedLogPath = decodeUrlParam(logPath) || logPath;

  if (sampleId !== undefined && sampleEpoch !== undefined) {
    // Encode sampleId to handle slashes and special characters
    // This must be done before encodePathParts since it splits on /
    const encodedSampleId = encodeURIComponent(String(sampleId));
    return encodePathParts(
      `${prefix}/${decodedLogPath}/samples/sample/${encodedSampleId}/${sampleEpoch}/${sampleTabId || ""}`
    );
  } else {
    return encodePathParts(
      `${prefix}/${decodedLogPath}/samples/${sampleTabId || ""}`
    );
  }
};

/**
 * Print route for a sample tab. `eventIds` narrows a transcript print to the
 * selected events (one `events=` param each, so ids never need a separator).
 */
export const printSampleUrl = (
  logPath: string,
  sampleId: string | number,
  epoch: string | number,
  view: string,
  prefix: RoutePrefix = "/logs",
  eventIds?: readonly string[]
) => {
  const decodedLogPath = decodeUrlParam(logPath) || logPath;
  const encodedSampleId = encodeURIComponent(String(sampleId));
  const eventParams = (eventIds ?? [])
    .map((id) => `&events=${encodeURIComponent(id)}`)
    .join("");
  return (
    encodePathParts(
      `${prefix}/${decodedLogPath}/samples/sample/${encodedSampleId}/${epoch}/print`
    ) + `?view=${view}${eventParams}`
  );
};

export const samplesSampleUrl = (
  logPath: string,
  sampleId: string | number,
  epoch: string | number,
  sampleTabId?: string
) => {
  const decodedLogPath = decodeUrlParam(logPath) || logPath;
  // Encode sampleId to handle slashes and special characters
  // This must be done before encodePathParts since it splits on /
  const encodedSampleId = encodeURIComponent(String(sampleId));
  return encodePathParts(
    `/samples/${decodedLogPath}/sample/${encodedSampleId}/${epoch}/${sampleTabId || ""}`
  );
};

export const sampleEventUrl = (
  builder: SampleUrlBuilder,
  eventId: string,
  logPath: string,
  sampleId?: string | number,
  sampleEpoch?: string | number
) => {
  const baseUrl = builder(
    logPath,
    sampleId,
    sampleEpoch,
    kSampleTranscriptTabId
  );
  return `${baseUrl}?event=${encodeURIComponent(eventId)}`;
};

/**
 * Hash route for the focus-mode page (single focused turn). Renders
 * only the given event and its descendants.
 *
 * Keeps the originating surface's prefix (`/logs`, `/tasks`, or `/samples` —
 * all three routers wire the `event` tab) so exiting focus mode and the
 * back/home buttons return to the surface the sample was opened from.
 */
const sampleEventFocusUrl = (
  eventId: string,
  logPath: string,
  sampleId?: string | number,
  sampleEpoch?: string | number,
  surface: RoutePrefix | "/samples" = "/logs"
) => {
  const baseUrl =
    surface === "/samples"
      ? samplesSampleUrl(
          logPath,
          sampleId ?? "",
          sampleEpoch ?? "",
          kSampleEventTabId
        )
      : logSamplesUrl(
          logPath,
          sampleId,
          sampleEpoch,
          kSampleEventTabId,
          surface
        );
  return `${baseUrl}?event=${encodeURIComponent(eventId)}`;
};

/**
 * Builder for the focus-mode entry href: a `#`-prefixed hash-route URL for the
 * single-event focus page. Relative `#…` so a ctrl/cmd- or middle-click opens
 * it in a new browser tab of the same SPA, while a plain click is intercepted
 * for in-window navigation (see `TranscriptLayout.onOpenEventFocus`). The
 * VS Code webview has no browser-tab model, but in-window focus mode works
 * there like any hash navigation, so the control is no longer suppressed.
 *
 * Returns undefined (hiding the control) when the log path / sample can't be
 * resolved.
 */
export const useSampleEventFocusUrlBuilder = (): ((
  eventId: string,
  selectedTab?: string
) => string | undefined) => {
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
  } = useLogOrSampleRouteParams();
  const location = useLocation();
  const sampleHandle = useCurrentSampleHandle();

  // Preserve the originating surface so leaving focus mode returns to it.
  const surface: RoutePrefix | "/samples" = location.pathname.startsWith(
    "/samples/"
  )
    ? "/samples"
    : location.pathname.startsWith("/tasks")
      ? "/tasks"
      : "/logs";

  return useCallback(
    (eventId: string, selectedTab?: string) => {
      const targetLogPath = urlLogPath;
      // Sample id + epoch normally come from the route, but the bare log URL
      // (single-sample auto-display) omits them; the selection provider derives
      // that sample from the log summaries.
      const sampleId = urlSampleId ?? sampleHandle?.id;
      const sampleEpoch = urlEpoch ?? sampleHandle?.epoch;
      if (
        !targetLogPath ||
        sampleId === undefined ||
        sampleEpoch === undefined
      ) {
        return undefined;
      }
      const base = `#${sampleEventFocusUrl(eventId, targetLogPath, sampleId, sampleEpoch, surface)}`;
      return selectedTab
        ? `${base}&tab=${encodeURIComponent(selectedTab)}`
        : base;
    },
    [urlLogPath, urlSampleId, urlEpoch, sampleHandle, surface]
  );
};

export const useSampleMessageUrl = (
  messageId: string | null | undefined,
  sampleId?: string | number,
  sampleEpoch?: string | number
) => {
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
  } = useLogOrSampleRouteParams();
  const builder = useSampleUrlBuilder();

  const targetLogPath = urlLogPath;

  const messageUrl = useMemo(() => {
    return messageId && targetLogPath
      ? sampleMessageUrl(
          builder,
          messageId,
          targetLogPath,
          sampleId || urlSampleId,
          sampleEpoch || urlEpoch
        )
      : undefined;
  }, [
    messageId,
    targetLogPath,
    builder,
    sampleId,
    urlSampleId,
    sampleEpoch,
    urlEpoch,
  ]);
  return messageUrl;
};

export const useSampleEventUrl = (
  eventId: string,
  sampleId?: string | number,
  sampleEpoch?: string | number
) => {
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
  } = useLogOrSampleRouteParams();
  const builder = useSampleUrlBuilder();

  const targetLogPath = urlLogPath;

  const eventUrl = useMemo(() => {
    return targetLogPath
      ? sampleEventUrl(
          builder,
          eventId,
          targetLogPath,
          sampleId || urlSampleId,
          sampleEpoch || urlEpoch
        )
      : undefined;
  }, [
    targetLogPath,
    builder,
    eventId,
    sampleId,
    urlSampleId,
    sampleEpoch,
    urlEpoch,
  ]);
  return eventUrl;
};

/**
 * Deep link to a message ID. `tab` selects the destination tab — Messages
 * (default) shows the message in the chat list; Transcript routes through
 * the transcript's resolver, which picks the best matching event in the
 * user's currently selected branch (and falls back to other branches).
 */
export const sampleMessageUrl = (
  builder: SampleUrlBuilder,
  messageId: string,
  logPath: string,
  sampleId?: string | number,
  sampleEpoch?: string | number,
  tab: string = kSampleMessagesTabId
) => {
  const baseUrl = builder(logPath, sampleId, sampleEpoch, tab);
  return `${baseUrl}?message=${messageId}`;
};

/**
 * Returns a builder for *shareable* message links: the relative hash route
 * from `sampleMessageUrl` wrapped with the host page's origin/path via
 * `toFullUrl`. Copy-to-clipboard consumers (ChatMessage's copy button) must
 * use this rather than the bare route, which only works for in-app router
 * navigation.
 */
export const useFullSampleMessageUrlBuilder = () => {
  const builder = useSampleUrlBuilder();
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
  } = useLogOrSampleRouteParams();

  const targetLogPath = urlLogPath;

  return useCallback(
    (messageId: string) =>
      toFullUrlMaybe(
        targetLogPath
          ? sampleMessageUrl(
              builder,
              messageId,
              targetLogPath,
              urlSampleId,
              urlEpoch
            )
          : undefined
      ),
    [builder, targetLogPath, urlSampleId, urlEpoch]
  );
};

export const tasksUrl = (log_file: string, log_dir?: string) => {
  const path = makeLogsPath(log_file, log_dir);
  const decodedLogSegment = decodeUrlParam(path) || path;
  return encodePathParts(`/tasks/${decodedLogSegment}`);
};

/**
 * Hook that parses tasks route parameters from the splat route.
 * Handles nested paths properly by parsing the full path after /tasks/
 */
export const useTasksRouteParams = () => {
  const location = useLocation();

  return useMemo(() => {
    const rawPath = location.pathname;

    // Extract the splat path (everything after /tasks/)
    const tasksMatch = rawPath.match(/^\/tasks\/(.*)$/);
    const splatPath = tasksMatch?.[1] ?? "";

    // Check for sample detail route: /tasks/path/to/file.eval/sample/id/epoch/tabId
    const sampleMatch = splatPath.match(
      /^(.+?)\/sample\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/
    );

    if (sampleMatch) {
      const [, logPath, sampleId, epoch, tabId] = sampleMatch;
      return {
        tasksPath: decodeUrlParam(logPath),
        sampleId: decodeUrlParam(sampleId),
        epoch: decodeUrlParam(epoch),
        tabId: tabId ? decodeUrlParam(tabId) : undefined,
      };
    }

    // Otherwise it's just a path (file or empty)
    return {
      tasksPath: splatPath ? decodeUrlParam(splatPath) : undefined,
      sampleId: undefined,
      epoch: undefined,
      tabId: undefined,
    };
  }, [location.pathname]);
};

export const samplesUrl = (log_file: string, log_dir?: string) => {
  const path = makeLogsPath(log_file, log_dir);
  const decodedLogSegment = decodeUrlParam(path) || path;
  return encodePathParts(`/samples/${decodedLogSegment}`);
};

export const logsUrl = (
  log_file: string,
  log_dir?: string,
  tabId?: string,
  prefix: RoutePrefix = "/logs"
) => {
  return logsUrlRaw(makeLogsPath(log_file, log_dir), tabId, prefix);
};

export const makeLogsPath = (log_file: string, log_dir?: string) => {
  const pathSegment = directoryRelativeUrl(log_file, log_dir);
  return pathSegment;
};

export const logsUrlRaw = (
  log_segment: string,
  tabId?: string,
  prefix: RoutePrefix = "/logs"
) => {
  // Ensure log_segment is decoded before encoding for URL construction
  const decodedLogSegment = decodeUrlParam(log_segment) || log_segment;

  if (tabId) {
    return encodePathParts(`${prefix}/${decodedLogSegment}/${tabId}`);
  } else {
    return encodePathParts(`${prefix}/${decodedLogSegment}`);
  }
};

export const toFullUrl = (path: string) => {
  return `${window.location.origin}${window.location.pathname}${window.location.search}#${path}`;
};

export const toFullUrlMaybe = (route: string | undefined) =>
  route ? toFullUrl(route) : undefined;

// Inverse of `toFullUrl`: recover the hash route from an absolute URL. Safe to
// split on the first `#` — origin/pathname/search never contain a raw `#`.
export const routeFromFullUrl = (url: string) => {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(hashIndex + 1) : url;
};
