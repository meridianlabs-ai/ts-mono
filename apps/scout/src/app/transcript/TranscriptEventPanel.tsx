import { skipToken } from "@tanstack/react-query";
import { FC, useCallback, useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { Event } from "@tsmono/inspect-common/types";
import {
  FocusTurnView,
  useEventNodes,
  useFocusLaneScope,
  useFocusSetParams,
  useFocusTurnNavigation,
} from "@tsmono/inspect-components/transcript";
import {
  ErrorPanel,
  LoadingBar,
  NoContentsPanel,
} from "@tsmono/react/components";
import { useRequiredParams } from "@tsmono/react/hooks";

import { parseTranscriptParams, transcriptRoute } from "../../router/url";
import { TranscriptsNavbar } from "../components/TranscriptsNavbar";
import { useAppConfig } from "../server/useAppConfig";
import { useTranscript } from "../server/useTranscript";
import { useTranscriptsDir } from "../utils/useTranscriptsDir";

import { kTranscriptEventsTabId } from "./TranscriptBody";
import styles from "./TranscriptEventPanel.module.css";
import { TranscriptNav } from "./TranscriptNav";

// Stable fallback while the transcript loads. A fresh `[]` per render would
// feed useTranscriptTimeline (via useFocusLaneScope) an ever-changing events
// identity, whose render-phase stackBase reset then re-renders forever
// ("Too many re-renders") as soon as anything re-renders the panel mid-load.
const kNoEvents: Event[] = [];

/**
 * Standalone single-event page (open-in-new-tab from a transcript event).
 * Renders the focused event (and its turn's tool calls) fully expanded, with
 * the transcript's own renderer but without the list's card/gutter chrome.
 * URL: /transcripts/<transcriptsDir>/<transcriptId>/event?event=<eventId>
 */
export const TranscriptEventPanel: FC = () => {
  const { transcriptId } = useRequiredParams("transcriptId");
  const routeParams = useParams<{ transcriptsDir: string }>();
  const { transcriptsDir } = parseTranscriptParams(routeParams);
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = searchParams.get("event");

  const config = useAppConfig();
  const {
    displayTranscriptsDir,
    resolvedTranscriptsDirSource,
    setTranscriptsDir,
  } = useTranscriptsDir(true);
  const filter = Array.isArray(config.filter)
    ? config.filter.join(" ")
    : config.filter;
  const {
    loading,
    data: transcript,
    error,
  } = useTranscript(
    config.transcripts
      ? { location: config.transcripts.dir, id: transcriptId }
      : skipToken
  );

  const scope = useFocusLaneScope(
    transcript?.events ?? kNoEvents,
    eventId,
    transcript?.timelines ?? undefined
  );
  const { eventNodes, defaultCollapsedIds } = useEventNodes(
    scope.laneEvents,
    false
  );
  const setParams = useFocusSetParams(setSearchParams);
  const nav = useFocusTurnNavigation(
    eventNodes,
    eventId,
    searchParams.get("tab") ?? "Summary",
    setParams,
    defaultCollapsedIds,
    scope
  );

  // Exit focus mode back to the transcript's events tab, deep-linked at the
  // focused event (`?event=`), so it opens scrolled to the same turn. Both the
  // exit control and the header Back button target this (mirrors inspect,
  // where Back also exits focus rather than jumping to the listing).
  const navigate = useNavigate();
  const { resolvedEventId } = nav;
  const exitUrl = useMemo(() => {
    if (!transcriptsDir) return undefined;
    const params = new URLSearchParams();
    params.set("tab", kTranscriptEventsTabId);
    if (resolvedEventId) params.set("event", resolvedEventId);
    return transcriptRoute(transcriptsDir, transcriptId, params);
  }, [transcriptsDir, transcriptId, resolvedEventId]);
  const onExit = useCallback(() => {
    if (!exitUrl) return;
    const result = navigate(exitUrl);
    if (result instanceof Promise) result.catch(() => undefined);
  }, [exitUrl, navigate]);

  // Reuse the transcript view's own header on the focus page (mirrors how the
  // inspect focus page reuses SampleNavbar): the breadcrumb navbar plus the
  // prev/next-transcript chevrons — which correctly disable when there is no
  // sibling — so the two views share one header instead of a bespoke bar. The
  // chevrons stay on the focus route (toFocusRoute). A transcript-level error
  // gets FocusTurnView's persistent strip (same as the inspect focus page).
  const header = (
    <TranscriptsNavbar
      transcriptsDir={displayTranscriptsDir || ""}
      transcriptsDirSource={resolvedTranscriptsDirSource}
      filter={filter}
      setTranscriptsDir={setTranscriptsDir}
      backUrl={exitUrl}
    >
      <TranscriptNav
        transcriptId={transcriptId}
        transcript={transcript}
        toFocusRoute
      />
    </TranscriptsNavbar>
  );

  if (error) {
    return (
      <>
        {header}
        <ErrorPanel title="Error Loading Transcript" error={error} />
      </>
    );
  }

  if (loading && !transcript) {
    return (
      <>
        {header}
        <LoadingBar loading />
        <div className={styles.loading}>
          loading transcript data
          <span className={styles.ellipsis} />
        </div>
      </>
    );
  }

  if (transcript && nav.slice.length === 0) {
    return (
      <>
        {header}
        <NoContentsPanel text="Event not found in this transcript." />
      </>
    );
  }

  return (
    <>
      <LoadingBar loading={loading} />
      <FocusTurnView
        nav={nav}
        eventId={eventId}
        header={header}
        className={styles.focusRoot}
        error={
          transcript?.error
            ? { label: "Transcript error", message: transcript.error }
            : undefined
        }
        onExit={onExit}
      />
    </>
  );
};
