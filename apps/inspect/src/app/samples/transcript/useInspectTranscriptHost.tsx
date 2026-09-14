import { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import type {
  SelectOptions,
  TranscriptHost,
} from "@tsmono/inspect-components/transcript";
import {
  navigateAndForget,
  useOpenEventFocus,
  useReflectEventNavigationInUrl,
} from "@tsmono/react/hooks";
import { isHostedEnvironment } from "@tsmono/util";

import { useLogDir } from "../../../app_config";
import { useStore } from "../../../state/store";
import {
  makeLogsPath,
  routeFromFullUrl,
  sampleEventUrl,
  toFullUrlMaybe,
  useLogOrSampleRouteParams,
  useSampleEventFocusUrlBuilder,
  useSampleUrlBuilder,
} from "../../routing/url";

interface InspectTranscriptHostOptions {
  /** Timeline row selection, so a marker click can select its row along
   *  with the jump. */
  setTimelineSelected: (key: string | null, options?: SelectOptions) => void;
  onHeadroomSetHidden: (hidden: boolean) => void;
  onHeadroomResetAnchor: (debounce?: boolean) => void;
}

/**
 * The transcript host for inspect's sample transcript panel: sample-route
 * deep-link URLs, react-router navigation, and the chrome headroom shared
 * with the sample header.
 */
export function useInspectTranscriptHost({
  setTimelineSelected,
  onHeadroomSetHidden,
  onHeadroomResetAnchor,
}: InspectTranscriptHostOptions): TranscriptHost {
  const builder = useSampleUrlBuilder();
  const {
    logPath: urlLogPath,
    id: urlSampleId,
    epoch: urlEpoch,
  } = useLogOrSampleRouteParams();
  const logFile = useStore((state) => state.logs.selectedLogFile);
  const logDir = useLogDir();

  const getEventUrl = (eventId: string) => {
    let targetLogPath = urlLogPath;
    if (!targetLogPath && logFile) {
      targetLogPath = makeLogsPath(logFile, logDir);
    }
    if (!targetLogPath) return undefined;
    return sampleEventUrl(
      builder,
      eventId,
      targetLogPath,
      urlSampleId,
      urlEpoch
    );
  };

  // The host's `getEventUrl` is dual-purpose: the copy button copies it
  // verbatim (needs an absolute, shareable URL), while the outline feeds it to
  // `renderLink` below (which strips the origin back off for in-app nav). So
  // the value handed to the transcript must be absolute.
  const getFullEventUrl = (eventId: string) =>
    toFullUrlMaybe(getEventUrl(eventId));

  const getEventFocusUrl = useSampleEventFocusUrlBuilder();

  const [, setSearchParams] = useSearchParams();
  const onNavigatedToEvent = useReflectEventNavigationInUrl(setSearchParams);
  const onOpenEventFocus = useOpenEventFocus();

  const navigate = useNavigate();
  const onMarkerNavigate = (eventId: string, selectedKey?: string) => {
    const url = getEventUrl(eventId);
    if (!url) return;
    if (selectedKey) {
      setTimelineSelected(selectedKey);
    }
    navigateAndForget(navigate, url, { replace: true });
  };

  // Outline link clicks are in-view navigation (jumping to an event in the
  // same transcript), so recover the hash route from the absolute URL and
  // use `replace` to keep the back button clean.
  const renderLink = (url: string, children: ReactNode) => (
    <Link to={routeFromFullUrl(url)} replace>
      {children}
    </Link>
  );

  return {
    urls: {
      getEventUrl: getFullEventUrl,
      getEventFocusUrl,
      // Only surface the copy-link button where a shared absolute URL is
      // meaningful — not in VS Code webviews or localhost. Matches the message
      // copy-link (SampleDisplay's `enabled: isHostedEnvironment()`).
      linkingEnabled: isHostedEnvironment(),
    },
    navigation: { onOpenEventFocus, onNavigatedToEvent, onMarkerNavigate },
    headroom: {
      setHidden: onHeadroomSetHidden,
      resetAnchor: onHeadroomResetAnchor,
    },
    outline: { renderLink },
  };
}
