import clsx from "clsx";
import { FC, useRef } from "react";

import { ErrorPanel, StickyScrollProvider } from "@tsmono/react/components";
import { useStatefulScrollPosition } from "@tsmono/react/hooks";

import { useSampleData } from "../../state/hooks";
import { useStore } from "../../state/store";
import { useLoadSample } from "../../state/useLoadSample";
import { usePollSample } from "../../state/usePollSample";

import styles from "./InlineSampleDisplay.module.css";
import { SampleDisplay } from "./SampleDisplay";

interface InlineSampleDisplayProps {
  showActivity?: boolean;
  className?: string | string[];
}

/**
 * Inline Sample Display
 */
export const InlineSampleDisplay: FC<InlineSampleDisplayProps> = ({
  showActivity,
  className,
}) => {
  // Use shared hooks for loading and polling
  useLoadSample();
  usePollSample();
  return (
    <InlineSampleComponent showActivity={showActivity} className={className} />
  );
};

export const InlineSampleComponent: FC<InlineSampleDisplayProps> = ({
  showActivity,
  className,
}) => {
  const sampleData = useSampleData();

  const sampleProgress =
    sampleData.status === "loading" &&
    sampleData.downloadProgress &&
    sampleData.downloadProgress.total > 0
      ? sampleData.downloadProgress.complete / sampleData.downloadProgress.total
      : undefined;

  // Scroll ref — key by active tab so each tab restores independently
  const scrollRef = useRef<HTMLDivElement>(null);
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
                showActivity={!!showActivity}
                progress={sampleProgress}
                scrollRef={scrollRef}
              />
            )}
          </div>
        </StickyScrollProvider>
      </div>
    </div>
  );
};
