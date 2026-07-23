import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { navigateAndForget } from "@tsmono/react/hooks";

import { useLoggingNavigate } from "../../../debugging/navigationDebugging";
import { transcriptFocusRoute, transcriptRoute } from "../../../router/url";
import { useStore } from "../../../state/store";
import { useFilterConditions } from "../../hooks/useFilterConditions";
import { useAdjacentTranscriptIds } from "../../server/useAdjacentTranscriptIds";
import { TRANSCRIPTS_INFINITE_SCROLL_CONFIG } from "../../transcripts/constants";
import { useTranscriptsDir } from "../../utils/useTranscriptsDir";

interface TranscriptPrevNext {
  prevId?: string;
  nextId?: string;
  /** Defined only when a previous/next sibling transcript exists. */
  onPrevious?: () => void;
  onNext?: () => void;
}

interface TranscriptPrevNextOptions {
  /** Navigate to the sibling's focus (single-event) route instead of its
   *  transcript view. The parameterless `event` URL there resolves to the
   *  sibling's first turn, so focus mode is never exited. */
  toFocusRoute?: boolean;
}

/**
 * Prev/next navigation between sibling transcripts, in the transcripts
 * table's current sort/filter order. Feeds the header chevrons
 * (TranscriptNav, reused on the focus page), which own the ArrowLeft /
 * ArrowRight binding via `NextPreviousNav`.
 *
 * @param transcriptId - The transcript whose siblings to navigate between.
 * @param options - Pass a module-level constant to keep the callbacks
 *   referentially stable.
 */
export const useTranscriptPrevNext = (
  transcriptId: string,
  options?: TranscriptPrevNextOptions
): TranscriptPrevNext => {
  const navigate = useLoggingNavigate("useTranscriptPrevNext");
  const [searchParams] = useSearchParams();
  const { resolvedTranscriptsDir } = useTranscriptsDir(true);

  const sorting = useStore((state) => state.transcriptsTableState.sorting);
  const condition = useFilterConditions();

  const adjacentIds = useAdjacentTranscriptIds(
    transcriptId,
    resolvedTranscriptsDir,
    TRANSCRIPTS_INFINITE_SCROLL_CONFIG.pageSize,
    condition,
    sorting
  );
  const [prevId, nextId] = adjacentIds.data ?? [undefined, undefined];

  const { toFocusRoute } = options ?? {};

  // Strip transcript-specific params when navigating to a different
  // transcript. The selected agent and deep-link targets don't carry over.
  const cleanParams = useMemo(() => {
    const next = new URLSearchParams(searchParams);
    next.delete("selected");
    next.delete("event");
    next.delete("message");
    // Land on the sibling's FIRST turn, not follow to its last.
    next.delete("follow");
    return next;
  }, [searchParams]);

  const siblingRoute = toFocusRoute ? transcriptFocusRoute : transcriptRoute;

  const onPrevious = useMemo(
    () =>
      prevId
        ? () => {
            navigateAndForget(
              navigate,
              siblingRoute(resolvedTranscriptsDir, prevId, cleanParams)
            );
          }
        : undefined,
    [prevId, navigate, siblingRoute, resolvedTranscriptsDir, cleanParams]
  );

  const onNext = useMemo(
    () =>
      nextId
        ? () => {
            navigateAndForget(
              navigate,
              siblingRoute(resolvedTranscriptsDir, nextId, cleanParams)
            );
          }
        : undefined,
    [nextId, navigate, siblingRoute, resolvedTranscriptsDir, cleanParams]
  );

  return { prevId, nextId, onPrevious, onNext };
};
