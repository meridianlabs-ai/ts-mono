import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ErrorPanel, LoadingBar } from "@tsmono/react/components";
import {
  useChromeNavOwnershipRelease,
  useDocumentTitle,
  useRequiredParams,
  useScrollDirection,
} from "@tsmono/react/hooks";
import { ApiError } from "@tsmono/util";

import { useStore } from "../../state/store";
import { TranscriptsNavbar } from "../components/TranscriptsNavbar";
import { useAppConfig } from "../server/useAppConfig";
import { useTranscript } from "../server/useTranscript";
import { getTranscriptDisplayName } from "../utils/transcript";
import { useTranscriptsDir } from "../utils/useTranscriptsDir";

import { TranscriptBody } from "./TranscriptBody";
import { TranscriptNav } from "./TranscriptNav";
import styles from "./TranscriptPanel.module.css";
import { TranscriptTitle } from "./TranscriptTitle";

export const TranscriptPanel: FC = () => {
  // The core scroll element for the transcript panel
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Transcript data from route
  const { transcriptId } = useRequiredParams("transcriptId");

  // Transcripts directory (resolved from route, user preference, or config)
  const {
    displayTranscriptsDir,
    resolvedTranscriptsDirSource,
    setTranscriptsDir,
  } = useTranscriptsDir(true);

  // Server transcripts directory
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
  const filter = Array.isArray(config.filter)
    ? config.filter.join(" ")
    : config.filter;

  // Set document title with transcript task name
  useDocumentTitle(getTranscriptDisplayName(transcript), "Transcripts");

  // Deep-link params (?event= / ?message=), read here — not only in
  // TranscriptBody — because a deep-linked mount lands scrolled down and the
  // chrome must render collapsed from the very first frame. Both are
  // mount-time signals only (initialHidden / navOwnsRef read them once).
  const [searchParams] = useSearchParams();
  const initialEventId = searchParams.get("event");
  const initialMessageId = searchParams.get("message");

  // While the find band is open it scrolls matches into view (Ctrl+F → next /
  // prev); those programmatic scrolls would otherwise read as user direction
  // changes and flicker the chrome open/closed. Freeze headroom detection
  // while find is active (a ref so the scroll handler sees the live value).
  const showFind = useStore((state) => state.showFind);
  const findActiveRef = useRef(showFind);
  useEffect(() => {
    findActiveRef.current = showFind;
  }, [showFind]);

  // Chrome ownership: two separate worlds, no interaction. Navigation (deep
  // links, f/h/j/k/l, go-to-turn) FORCES the chrome state and, while it owns
  // it, the natural-scroll detection below is fully suppressed — j/k can
  // never flicker the chrome, and once collapsed it stays collapsed until
  // `kkk` reaches the very top (which forces expand). A physical user gesture
  // (wheel / touch on the scroller) hands ownership back to the natural
  // world, which resumes fresh from the current position (the hook resets
  // its anchor when suppression ends).
  const navOwnsRef = useRef(!!(initialEventId || initialMessageId));
  const suppressRef = useMemo(
    () => ({
      get current() {
        return findActiveRef.current || navOwnsRef.current;
      },
    }),
    []
  );
  useChromeNavOwnershipRelease(navOwnsRef, scrollRef);

  // Headroom: show title on scroll-up, hide on scroll-down.
  // Shared with the swimlane headroom in TimelineEventsView so both
  // collapse/expand in sync from a single scroll-direction signal.
  const {
    hidden: headroomHidden,
    resetAnchor: headroomResetAnchor,
    setHidden: setHeadroomHidden,
  } = useScrollDirection(scrollRef, {
    suppressRef,
    // A deep-linked mount (?event= or ?message=) lands scrolled down — start
    // collapsed instead of painting the title headroom expanded for a frame
    // and blinking away. Bare mounts start expanded, statically (no state
    // flip, so no transition runs on load).
    initialHidden: !!(initialEventId || initialMessageId),
  });

  const onHeadroomSetHidden = useCallback(
    (hidden: boolean) => {
      // Every force claims ownership (suppressing natural detection). Scout's
      // whole chrome (this title headroom + the swimlane strip inside
      // TranscriptLayout) hangs off the ONE hidden signal, so inspect's
      // sample-header rule applies to all of it: collapse follows every
      // caller (nav landing, find-forward), but expand only when the scroll
      // really is at the top (`k` past turn 1) — not on find-prev mid-log.
      navOwnsRef.current = true;
      if (hidden || (scrollRef.current?.scrollTop ?? 0) <= 0) {
        setHeadroomHidden(hidden);
      }
    },
    [setHeadroomHidden]
  );

  // TranscriptPanel isn't keyed per-transcript (the route element is the
  // same one across sibling hops, e.g. ArrowRight), so navOwnsRef/headroomHidden
  // — both seeded once via useRef/initialHidden — would otherwise carry a
  // deep-linked transcript's collapsed chrome onto the next bare one (or vice
  // versa). Re-derive both from the CURRENT mount's own params whenever
  // transcriptId changes, in the render phase (not an effect) so it applies
  // before paint — matching useScrollDirection's own scroller-changed reset,
  // which can't help here since the scroll container element itself doesn't
  // remount across the hop either.
  const [chromeResetForId, setChromeResetForId] = useState(transcriptId);
  if (chromeResetForId !== transcriptId) {
    setChromeResetForId(transcriptId);
    const startsCollapsed = !!(initialEventId || initialMessageId);
    // eslint-disable-next-line react-hooks/refs -- deliberate render-phase reset: must land in the SAME render transcriptId changes, or the old transcript's chrome state paints for a frame before this corrects it
    navOwnsRef.current = startsCollapsed;
    if (headroomHidden !== startsCollapsed) setHeadroomHidden(startsCollapsed);
  }

  return (
    <div className={clsx(styles.container)}>
      <TranscriptsNavbar
        transcriptsDir={displayTranscriptsDir || ""}
        transcriptsDirSource={resolvedTranscriptsDirSource}
        filter={filter}
        setTranscriptsDir={setTranscriptsDir}
      >
        <TranscriptNav transcriptId={transcriptId} transcript={transcript} />
      </TranscriptsNavbar>
      <LoadingBar loading={loading} />

      {!error && transcript && (
        <>
          <div
            className={clsx(
              styles.titleHeadroom,
              headroomHidden && styles.titleHidden
            )}
          >
            <div className={styles.titleHeadroomInner}>
              <TranscriptTitle transcript={transcript} />
            </div>
          </div>
          <div className={styles.transcriptContainer} ref={scrollRef}>
            <TranscriptBody
              transcript={transcript}
              scrollRef={scrollRef}
              headroomHidden={headroomHidden}
              onHeadroomResetAnchor={headroomResetAnchor}
              onHeadroomSetHidden={onHeadroomSetHidden}
            />
          </div>
        </>
      )}
      {error && (
        <ErrorPanel
          title={
            error instanceof ApiError && error.status === 413
              ? "Transcript Too Large"
              : "Error Loading Transcript"
          }
          error={
            error instanceof ApiError && error.status === 413
              ? { message: "This transcript exceeds the maximum size limit." }
              : error
          }
        />
      )}
    </div>
  );
};
