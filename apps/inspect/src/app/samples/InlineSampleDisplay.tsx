import clsx from "clsx";
import { FC, RefObject, useRef } from "react";

import { ErrorPanel, StickyScrollProvider } from "@tsmono/react/components";
import { useStatefulScrollPosition } from "@tsmono/react/hooks";

import { useSampleData } from "../../state/hooks";
import { useStore } from "../../state/store";
import { useLoadSampleSideEffect } from "../../state/useLoadSampleSideEffect";
import { usePollSampleSideEffect } from "../../state/usePollSampleSideEffect";

import styles from "./InlineSampleDisplay.module.css";
import { SampleDisplay } from "./SampleDisplay";

interface InlineSampleDisplayProps {
  className?: string | string[];
  /** Optional ref that receives the inner scroller element so callers can
   *  hook scroll listeners on the actual scrolling viewport. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Inline Sample Display
 */
export const InlineSampleDisplay: FC<InlineSampleDisplayProps> = ({
  className,
  scrollRef,
}) => {
  // Use shared hooks for loading and polling
  useLoadSampleSideEffect();
  usePollSampleSideEffect();
  return <InlineSampleComponent className={className} scrollRef={scrollRef} />;
};

export const InlineSampleComponent: FC<InlineSampleDisplayProps> = ({
  className,
  scrollRef: externalScrollRef,
}) => {
  const sampleData = useSampleData();
  const showActivity =
    sampleData.status === "loading" || sampleData.status === "streaming";

  const localScrollRef = useRef<HTMLDivElement>(null);
  const scrollRef = externalScrollRef ?? localScrollRef;
  const sampleTab = useStore((state) => state.app.tabs.sample);
  useStatefulScrollPosition(scrollRef, `inline-sample-scroller-${sampleTab}`);

  return (
    <div className={clsx(className, styles.container)}>
      <div className={clsx(styles.scroller)} ref={scrollRef}>
        <StickyScrollProvider value={scrollRef}>
          <div className={styles.body}>
            {sampleData.error ? (
              <ErrorPanel
                title="Unable to load sample"
                error={sampleData.error}
              />
            ) : (
              <SampleDisplay
                id={"inline-sample-display"}
                showActivity={showActivity}
                scrollRef={scrollRef}
              />
            )}
          </div>
        </StickyScrollProvider>
      </div>
    </div>
  );
};
