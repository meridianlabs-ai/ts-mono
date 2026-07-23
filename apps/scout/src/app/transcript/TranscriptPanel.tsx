import { skipToken } from "@tanstack/react-query";
import clsx from "clsx";
import { FC, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { ErrorPanel, LoadingBar } from "@tsmono/react/components";
import {
  useChromeNavOwnership,
  useDocumentTitle,
  useRequiredParams,
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
  const showFind = useStore((state) => state.showFind) ?? false;
  const findActiveRef = useRef(showFind);
  useEffect(() => {
    findActiveRef.current = showFind;
  }, [showFind]);

  // Nav-owned chrome (see useChromeNavOwnership). Scout's whole chrome (this
  // title headroom + the swimlane strip inside TranscriptLayout) hangs off
  // the ONE hidden signal, so it re-expands only at the very top
  // (expandOnlyAtTop). resetKey: the route element and scroll container both
  // survive sibling hops (ArrowRight), so ownership and the hidden state
  // re-derive from the current params when transcriptId changes.
  const {
    hidden: headroomHidden,
    resetAnchor: headroomResetAnchor,
    forceHidden: onHeadroomSetHidden,
  } = useChromeNavOwnership(scrollRef, {
    ownedForKey: () => !!(initialEventId || initialMessageId),
    resetKey: transcriptId,
    findActiveRef,
    expandOnlyAtTop: true,
  });

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
