import { RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router";

import type { TranscriptHost } from "@tsmono/inspect-components/transcript";
import {
  navigateAndForget,
  useReflectEventNavigationInUrl,
} from "@tsmono/react/hooks";
import { isHostedEnvironment } from "@tsmono/util";

import { useTranscriptNavigation } from "./useTranscriptNavigation";

interface ScoutTranscriptHostChrome {
  /** The transcript's scroll container: the swimlane header's root
   *  breadcrumb scrolls it back to the top. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Force the chrome shown/hidden. Every call claims nav ownership of the
   *  chrome — see the page's useChromeNavOwnership. */
  onHeadroomSetHidden?: (hidden: boolean) => void;
  /** Reset the headroom anchor before a layout shift or programmatic scroll;
   *  `true` debounces (keeps the lock alive while scrolling continues). */
  onHeadroomResetAnchor?: (debounce?: boolean) => void;
}

/**
 * The transcript host for scout surfaces that have collapsing chrome but no
 * transcript route of their own (scan-result inputs): headroom plus the
 * header's scroll-to-top, no deep-link URLs or router navigation.
 */
export function useScoutChromeTranscriptHost({
  scrollRef,
  onHeadroomSetHidden,
  onHeadroomResetAnchor,
}: ScoutTranscriptHostChrome): TranscriptHost {
  return {
    navigation: {
      onScrollToTop: () => scrollRef.current?.scrollTo({ top: 0 }),
    },
    headroom: {
      setHidden: onHeadroomSetHidden,
      resetAnchor: onHeadroomResetAnchor,
    },
  };
}

/**
 * The transcript host for the transcript page: the chrome host above plus
 * transcript-route deep-link URLs and react-router navigation.
 */
export function useScoutTranscriptHost(
  chrome: ScoutTranscriptHostChrome
): TranscriptHost {
  const { navigation, headroom } = useScoutChromeTranscriptHost(chrome);
  const { getEventUrl, getFullEventUrl, getEventFocusUrl, onOpenEventFocus } =
    useTranscriptNavigation();
  const [, setSearchParams] = useSearchParams();
  const onNavigatedToEvent = useReflectEventNavigationInUrl(setSearchParams);
  const navigate = useNavigate();

  // A marker click with `selectedKey` (compaction markers) selects the bar in
  // the same URL update as the jump, so setSearchParams and navigate can't race.
  const onMarkerNavigate = (eventId: string, selectedKey?: string) => {
    const url = getEventUrl(eventId, selectedKey);
    if (!url) return;
    navigateAndForget(navigate, url, { replace: true });
  };

  return {
    urls: {
      // Absolute: the copy button copies it verbatim, and the outline's plain
      // <a href> follows it (same document, hash change only).
      getEventUrl: getFullEventUrl,
      getEventFocusUrl,
      linkingEnabled: isHostedEnvironment(),
    },
    navigation: {
      ...navigation,
      onOpenEventFocus,
      onNavigatedToEvent,
      onMarkerNavigate,
    },
    headroom,
  };
}
