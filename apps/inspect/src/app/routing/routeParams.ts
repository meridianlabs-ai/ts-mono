import { useMemo } from "react";
import { useLocation, useParams } from "react-router";

import { tryDecodeURIComponent } from "@tsmono/util";

import { kSampleTabIds, kWorkspaceTabs } from "../../constants";

/**
 * Decodes a URL parameter that may be URL-encoded.
 * Safely handles already decoded strings.
 */
export const decodeUrlParam = (
  param: string | undefined
): string | undefined => {
  if (!param) return param;
  return tryDecodeURIComponent(param);
};

/**
 * Hook that provides URL parameters with automatic decoding.
 * Use this instead of useParams when you need the actual unencoded values.
 */
export const useDecodedParams = <
  T extends Record<string, string | undefined>,
>() => {
  const params = useParams<T>();

  const decodedParams = useMemo(() => {
    const decoded: Record<string, string | undefined> = {};
    Object.entries(params).forEach(([key, value]) => {
      decoded[key] =
        typeof value === "string" ? decodeUrlParam(value) : undefined;
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a mapped type over a generic key union has no empty value to build from; every key of T is filled above
    return decoded as T;
  }, [params]);

  return decodedParams;
};

export interface LogOrSampleRouteParams {
  logPath?: string;
  id?: string;
  epoch?: string;
  sampleTabId?: string;
  tabId?: string;
  uuid: string | undefined;
}

export function selectionRouteParams(pathname: string): LogOrSampleRouteParams {
  if (pathname.startsWith("/samples/")) {
    const params = parseSamplesRouteParams(pathname.slice("/samples/".length));
    return {
      logPath: params.samplesPath,
      id: params.sampleId,
      epoch: params.epoch,
      sampleTabId: params.tabId,
      uuid: undefined,
    };
  }
  const match = pathname.match(/^\/(logs|tasks)\/(.*)$/);
  const params = parseLogRouteParams(match?.[2] ?? "");
  return {
    logPath: params.logPath,
    id: params.sampleId,
    epoch: params.epoch,
    sampleTabId: params.sampleTabId,
    tabId: params.tabId,
    uuid: params.sampleUuid,
  };
}

export const useLogOrSampleRouteParams = (): LogOrSampleRouteParams =>
  selectionRouteParams(useLocation().pathname);

export interface LogRouteParams {
  logPath?: string;
  tabId?: string;
  sampleTabId?: string;
  sampleId?: string;
  epoch?: string;
  sampleUuid?: string;
}

/**
 * Parses log route parameters from the splat path (everything after
 * /logs/ or /tasks/). Pure so it can be tested without a router.
 */
export const parseLogRouteParams = (splatPath: string): LogRouteParams => {
  // Check for sample UUID route pattern
  const sampleUuidMatch = splatPath.match(
    /^(.+?)\/samples\/sample_uuid\/([^/]+)(?:\/(.+?))?\/?\s*$/
  );
  if (sampleUuidMatch) {
    const [, logPath, sampleUuid, sampleTabId] = sampleUuidMatch;
    return {
      logPath: decodeUrlParam(logPath),
      tabId: undefined,
      sampleTabId: decodeUrlParam(sampleTabId),
      sampleId: undefined,
      epoch: undefined,
      sampleUuid: decodeUrlParam(sampleUuid),
    };
  }

  // Check for full sample route pattern in splat path (when route params aren't populated)
  // Pattern: logPath/samples/sample/sampleId/epoch/sampleTabId (with optional trailing slash)
  const fullSampleUrlMatch = splatPath.match(
    /^(.+?)\/samples\/sample\/([^/]+)(?:\/([^/]+)(?:\/(.+?))?)?\/?\s*$/
  );
  if (fullSampleUrlMatch) {
    const [, logPath, sampleId, epoch, sampleTabId] = fullSampleUrlMatch;
    return {
      logPath: decodeUrlParam(logPath),
      tabId: undefined,
      sampleTabId: decodeUrlParam(sampleTabId),
      sampleId: decodeUrlParam(sampleId),
      epoch: epoch ? decodeUrlParam(epoch) : undefined,
    };
  }

  // Check for sample URLs that might not match the formal route pattern
  // (this is the single sample case, where is there is now sampleid/epoch, just sampletabid)
  // Pattern: /logs/*/samples/sampleId/epoch or /logs/*/samples/sampleId or /logs/*/samples/sampleTabId
  const sampleUrlMatch = splatPath.match(
    /^(.+?)\/samples(?:\/([^/]+)(?:\/([^/]+))?)?$/
  );
  if (sampleUrlMatch) {
    const [, logPath, firstSegment, secondSegment] = sampleUrlMatch;

    if (firstSegment) {
      // Define known sample tab IDs
      const validSampleTabIds = new Set(kSampleTabIds);

      if (validSampleTabIds.has(firstSegment) && !secondSegment) {
        // This is /logs/*/samples/sampleTabId
        return {
          logPath: decodeUrlParam(logPath),
          tabId: "samples",
          sampleTabId: decodeUrlParam(firstSegment),
          sampleId: undefined,
          epoch: undefined,
        };
      } else {
        // This is a sample URL with sampleId (and possibly epoch)
        return {
          logPath: decodeUrlParam(logPath),
          tabId: undefined,
          sampleTabId: undefined,
          sampleId: decodeUrlParam(firstSegment),
          epoch: secondSegment ? decodeUrlParam(secondSegment) : undefined,
        };
      }
    } else {
      // This is just /logs/*/samples (samples listing)
      return {
        logPath: decodeUrlParam(logPath),
        tabId: "samples",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      };
    }
  }

  // Regular log route pattern: /logs/path/to/file.eval/tabId?
  // Split the path and check if the last segment might be a tabId
  const pathSegments = splatPath.split("/").filter(Boolean);

  if (pathSegments.length === 0) {
    return {
      logPath: undefined,
      tabId: undefined,
      sampleTabId: undefined,
      sampleId: undefined,
      epoch: undefined,
    };
  }

  // Define valid tab IDs for log view
  const validTabIds = new Set(kWorkspaceTabs);

  // Look for the first valid tab ID from right to left
  let tabIdIndex = -1;
  let foundTabId: string | undefined = undefined;

  for (let i = pathSegments.length - 1; i >= 0; i--) {
    const segment = pathSegments[i];
    if (segment === undefined) continue;
    const decodedSegment = decodeUrlParam(segment) || segment;

    if (validTabIds.has(decodedSegment)) {
      tabIdIndex = i;
      foundTabId = decodedSegment;
      break;
    }
  }

  if (foundTabId && tabIdIndex > 0) {
    // Found a valid tab ID, split the path there
    const pathSlice = pathSegments.slice(0, tabIdIndex);
    const firstSegment = pathSlice[0];
    const logPath =
      firstSegment?.endsWith(":") && !firstSegment.includes("://")
        ? firstSegment +
          (firstSegment === "file:" ? "///" : "//") +
          pathSlice.slice(1).join("/")
        : pathSlice.join("/");

    return {
      logPath: decodeUrlParam(logPath),
      tabId: foundTabId,
      sampleTabId: undefined,
      sampleId: undefined,
      epoch: undefined,
    };
  } else {
    // No valid tab ID found, the entire path is the logPath
    return {
      logPath: decodeUrlParam(splatPath),
      tabId: undefined,
      sampleTabId: undefined,
      sampleId: undefined,
      epoch: undefined,
    };
  }
};

/**
 * Hook that parses log route parameters from the splat route.
 * Handles nested paths properly by parsing the full path after /logs/
 *
 * Note: We use the raw URL hash instead of React Router's decoded params
 * because React Router decodes %2F to /, which breaks parsing of sample IDs
 * that contain slashes (e.g., "ascii/bike" encoded as "ascii%2Fbike").
 */
export const useLogRouteParams = () => {
  const location = useLocation();

  return useMemo(() => {
    // location.pathname keeps encoding intact; for hash routing it is the
    // part after # but before ?
    // Example: /logs/path/to/file.eval/samples/sample/ascii%2Fbike/1
    const logsMatch = location.pathname.match(/^\/(logs|tasks)\/(.*)$/);
    return parseLogRouteParams(logsMatch?.[2] ?? "");
  }, [location.pathname]);
};

/**
 * Parses samples route parameters from the splat path (everything after
 * /samples/), including sample detail routes
 * (/samples/path/to/file.eval/sample/id/epoch). Pure so it can be tested
 * without a router.
 */
export const parseSamplesRouteParams = (splatPath: string) => {
  const sampleMatch = splatPath.match(
    /^(.+?)\/sample\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/
  );

  if (sampleMatch) {
    const [, logPath, sampleId, epoch, tabId] = sampleMatch;
    return {
      samplesPath: decodeUrlParam(logPath),
      sampleId: decodeUrlParam(sampleId),
      epoch: decodeUrlParam(epoch),
      tabId: tabId ? decodeUrlParam(tabId) : undefined,
    };
  }

  // Otherwise it's just a folder path
  return {
    samplesPath: splatPath ? decodeUrlParam(splatPath) : undefined,
    sampleId: undefined,
    epoch: undefined,
    tabId: undefined,
  };
};

/**
 * Hook that parses samples route parameters from the splat route.
 *
 * Note: We use location.pathname instead of React Router's decoded params
 * because React Router decodes %2F to /, which breaks parsing of sample IDs
 * that contain slashes (e.g., "ascii/bike" encoded as "ascii%2Fbike").
 */
export const useSamplesRouteParams = () => {
  const location = useLocation();

  return useMemo(() => {
    const samplesMatch = location.pathname.match(/^\/samples\/(.*)$/);
    return parseSamplesRouteParams(samplesMatch?.[1] ?? "");
  }, [location.pathname]);
};
