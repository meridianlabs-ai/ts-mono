/**
 * The transcript host: the per-app behavior the shared transcript components
 * need from whichever app mounts them (URL shapes, router navigation, the
 * page's collapsing chrome, the outline's link element). An app assembles one
 * `TranscriptHost` and provides it once above `TranscriptLayout`; the leaves
 * (`TranscriptViewNodes`, `EventPanel`, `OutlineRow`, ...) read it from
 * context instead of receiving each callback as a prop.
 *
 * Every field is optional and every consumer degrades when a field is absent
 * (no copy-link button, plain `<a>` outline links, no focus-mode control, no
 * chrome to collapse), so mounts without a host — previews, embedded cards,
 * scanner results — render without a provider.
 */

import { createContext, FC, ReactNode, useContext } from "react";

/** Deep-link URL builders. */
export interface TranscriptHostUrls {
  /** Shareable URL for an event. Dual-purpose: the event header's copy button
   *  copies it verbatim (so it must be absolute) and the outline uses it as a
   *  link href (through `outline.renderLink` when provided). */
  getEventUrl?: (eventId: string) => string | undefined;
  /** Focus-mode entry href for an event, carrying the panel's selected tab
   *  (plain click enters in-window; modified clicks open a new tab). Omit to
   *  hide the focus controls (header icon and `f` key). */
  getEventFocusUrl?: (
    eventId: string,
    selectedTab?: string
  ) => string | undefined;
  /** Whether the event header shows its copy-link button. Gates only the copy
   *  button: outline links render whenever `getEventUrl` yields a URL. */
  linkingEnabled?: boolean;
}

/** Router-backed navigation the transcript triggers. */
export interface TranscriptHostNavigation {
  /** Enter focus mode in the current window from the SAME href
   *  `getEventFocusUrl` built (`#`-prefixed hrefs accepted). */
  onOpenEventFocus?: (focusRoute: string) => void;
  /** Reflect an explicit turn navigation (j/k, chevrons, go-to-turn bar, lane
   *  hops) in the URL (`?event=`, replace) — like an outline click. Never
   *  called on passive scroll. */
  onNavigatedToEvent?: (eventId: string) => void;
  /** A swimlane marker (error, compaction, ...) was clicked. `selectedKey`
   *  asks for that swimlane row to be selected atomically with the jump. */
  onMarkerNavigate?: (eventId: string, selectedKey?: string) => void;
  /** The swimlane header's root breadcrumb was clicked. */
  onScrollToTop?: () => void;
}

/** The app chrome above the transcript that collapses on scroll. */
export interface TranscriptHostHeadroom {
  /** Force the chrome to the state an equivalent manual scroll would produce:
   *  nav/deep-link landings collapse it, `k` past turn 1 re-expands it, and
   *  search Next/Prev follow the search direction. */
  setHidden?: (hidden: boolean) => void;
  /** Reset the scroll-direction anchor before a programmatic scroll or layout
   *  shift so it isn't read as a user gesture; `true` engages the debounced
   *  lock that stays alive while the scroll keeps settling. */
  resetAnchor?: (debounce?: boolean) => void;
}

/** The outline sidebar's host-specific rendering. */
export interface TranscriptHostOutline {
  /** Renders an outline row's link for `url` (from `urls.getEventUrl`), e.g.
   *  a router `<Link>` that recovers the in-app route from the absolute URL.
   *  Omit for a plain `<a href>`. */
  renderLink?: (url: string, children: ReactNode) => ReactNode;
}

export interface TranscriptHost {
  urls?: TranscriptHostUrls;
  navigation?: TranscriptHostNavigation;
  headroom?: TranscriptHostHeadroom;
  outline?: TranscriptHostOutline;
}

/** The host every mount without a provider sees. */
export const kEmptyTranscriptHost: TranscriptHost = Object.freeze({});

const TranscriptHostContext =
  createContext<TranscriptHost>(kEmptyTranscriptHost);

export const TranscriptHostProvider: FC<{
  host: TranscriptHost;
  children?: ReactNode;
}> = ({ host, children }) => (
  <TranscriptHostContext.Provider value={host}>
    {children}
  </TranscriptHostContext.Provider>
);

/** The mount's host, or the empty host when none is provided. Never throws. */
export function useTranscriptHost(): TranscriptHost {
  return useContext(TranscriptHostContext);
}
