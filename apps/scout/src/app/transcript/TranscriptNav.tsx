import { FC } from "react";

import { Transcript } from "../../types/api-types";
import { NextPreviousNav } from "../components/NextPreviousNav";
import { TaskName } from "../components/TaskName";

import { useTranscriptPrevNext } from "./hooks/useTranscriptPrevNext";

interface TranscriptNavProps {
  transcriptId: string;
  transcript?: Transcript;
  /** Keep sibling navigation on the focus (single-event) route instead of the
   *  transcript view — for the focus page, which reuses this header. */
  toFocusRoute?: boolean;
}

export const TranscriptNav: FC<TranscriptNavProps> = ({
  transcriptId,
  transcript,
  toFocusRoute,
}) => {
  const { prevId, nextId, onPrevious, onNext } = useTranscriptPrevNext(
    transcriptId,
    toFocusRoute ? { toFocusRoute: true } : undefined
  );

  return (
    <NextPreviousNav
      onPrevious={onPrevious}
      onNext={onNext}
      hasPrevious={!!prevId}
      hasNext={!!nextId}
      previousTitle="Previous transcript"
      nextTitle="Next transcript"
    >
      {transcript && (
        <TaskName
          taskId={transcript.task_id}
          taskRepeat={transcript.task_repeat}
          taskSet={transcript.task_set}
        />
      )}
    </NextPreviousNav>
  );
};
