import clsx from "clsx";
import { FC, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { ChatViewVirtualList } from "@tsmono/inspect-components/chat";
import { NoContentsPanel } from "@tsmono/react/components";
import { useChromeNavOwnership } from "@tsmono/react/hooks";

import { useStore } from "../../../state/store";
import { ScannerInput } from "../../../types/api-types";
import { ColumnHeader } from "../../components/ColumnHeader";
import { TimelineEventsView } from "../../timeline/components/TimelineEventsView";
import {
  isEventInput,
  isEventsInput,
  isMessageInput,
  isMessagesInput,
  isTranscriptInput,
  ScanResultData,
} from "../../types";

import styles from "./ResultBody.module.css";

export interface ResultBodyProps {
  resultData: ScanResultData;
  inputData: ScannerInput;
}

export const ResultBody: FC<ResultBodyProps> = ({ resultData, inputData }) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [searchParams] = useSearchParams();

  // Get message or event ID from query params
  const initialMessageId = searchParams.get("message");
  const initialEventId = searchParams.get("event");

  // While the find band is open it scrolls matches into view; freeze
  // headroom detection so those programmatic scrolls don't flicker the
  // chrome (this surface's keyboard nav already stands down for find — see
  // TimelineEventsView's keyboardNavDisabled).
  const showFind = useStore((state) => state.showFind) ?? false;
  const findActiveRef = useRef(showFind);
  useEffect(() => {
    findActiveRef.current = showFind;
  }, [showFind]);

  // Nav-owned chrome with the ownership contract shared with the transcript
  // page (see useChromeNavOwnership); the single chrome signal re-expands
  // only at the very top.
  const {
    hidden: headroomHidden,
    resetAnchor: headroomResetAnchor,
    forceHidden: onHeadroomSetHidden,
  } = useChromeNavOwnership(scrollRef, {
    ownedForKey: () => !!(initialEventId || initialMessageId),
    findActiveRef,
    expandOnlyAtTop: true,
  });

  const highlightLabeled = useStore((state) => state.highlightLabeled);

  return (
    <div className={clsx(styles.container, containerClass(inputData))}>
      <ColumnHeader label="Input" />
      <div ref={scrollRef} className={clsx(styles.scrollable)}>
        <InputRenderer
          resultData={resultData}
          inputData={inputData}
          scrollRef={scrollRef}
          initialMessageId={initialMessageId}
          initialEventId={initialEventId}
          highlightLabeled={highlightLabeled}
          headroomHidden={headroomHidden}
          onHeadroomResetAnchor={headroomResetAnchor}
          onHeadroomSetHidden={onHeadroomSetHidden}
        />
      </div>
    </div>
  );
};

interface InputRendererProps {
  className?: string | string[];
  resultData?: ScanResultData;
  inputData: ScannerInput;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  initialMessageId?: string | null;
  initialEventId?: string | null;
  highlightLabeled?: boolean;
  headroomHidden?: boolean;
  onHeadroomSetHidden?: (hidden: boolean) => void;
  onHeadroomResetAnchor?: (debounce?: boolean) => void;
}

const containerClass = (
  inputData: ScannerInput
): string | string[] | undefined => {
  if (isTranscriptInput(inputData)) {
    return styles.transcriptInputContainer;
  } else if (isEventsInput(inputData)) {
    return styles.eventsInputContainer;
  } else {
    return styles.chatInputContainer;
  }
};

const InputRenderer: FC<InputRendererProps> = ({
  resultData,
  inputData,
  className,
  scrollRef,
  initialMessageId,
  initialEventId,
  highlightLabeled,
  headroomHidden,
  onHeadroomSetHidden,
  onHeadroomResetAnchor,
}) => {
  if (isTranscriptInput(inputData)) {
    if (inputData.input.messages && inputData.input.messages.length > 0) {
      const labels = resultData?.messageReferences.reduce((acc, ref) => {
        if (ref.cite) {
          acc[ref.id] = ref.cite;
        }
        return acc;
      }, {});

      return (
        <ChatViewVirtualList
          messages={inputData.input.messages || []}
          id={"scan-input-virtual-list"}
          display={{ indented: true }}
          className={className}
          scrollRef={scrollRef}
          initialMessageId={initialMessageId}
          labels={{ highlight: highlightLabeled, messageLabels: labels }}
        />
      );
    } else if (inputData.input.events && inputData.input.events.length > 0) {
      return (
        <TimelineEventsView
          events={inputData.input.events}
          timelines={inputData.input.timelines}
          scrollRef={scrollRef}
          id="scan-input-events"
          initialEventId={initialEventId}
          initialMessageId={initialMessageId}
          headroomHidden={headroomHidden}
          onHeadroomSetHidden={onHeadroomSetHidden}
          onHeadroomResetAnchor={onHeadroomResetAnchor}
        />
      );
    } else {
      return <NoContentsPanel text="No transcript input available" />;
    }
  } else if (isMessagesInput(inputData)) {
    return (
      <ChatViewVirtualList
        messages={inputData.input}
        id={"scan-input-virtual-list"}
        display={{ indented: true }}
        className={className}
        scrollRef={scrollRef}
        initialMessageId={initialMessageId}
      />
    );
  } else if (isMessageInput(inputData)) {
    return (
      <ChatViewVirtualList
        messages={[inputData.input]}
        id={"scan-input-virtual-list"}
        display={{ indented: true }}
        className={className}
        scrollRef={scrollRef}
        initialMessageId={initialMessageId}
      />
    );
  } else if (isEventsInput(inputData)) {
    return (
      <TimelineEventsView
        events={inputData.input}
        scrollRef={scrollRef}
        id="scan-input-events"
        initialEventId={initialEventId}
        initialMessageId={initialMessageId}
        timeline={false}
        headroomHidden={headroomHidden}
        onHeadroomSetHidden={onHeadroomSetHidden}
        onHeadroomResetAnchor={onHeadroomResetAnchor}
      />
    );
  } else if (isEventInput(inputData)) {
    return (
      <TimelineEventsView
        events={[inputData.input]}
        scrollRef={scrollRef}
        id="scan-input-events"
        initialEventId={initialEventId}
        initialMessageId={initialMessageId}
        timeline={false}
        headroomHidden={headroomHidden}
        onHeadroomSetHidden={onHeadroomSetHidden}
        onHeadroomResetAnchor={onHeadroomResetAnchor}
      />
    );
  } else {
    return <div>Unsupported Input Type</div>;
  }
};
