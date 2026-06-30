import { FC, useCallback, useEffect, useMemo } from "react";

import {
  ExtendedFindProvider,
  FindTargetProvider,
} from "@tsmono/react/components";

import { FindBand } from "../../components/FindBand";
import { useSampleData } from "../../state/hooks";
import { useStore } from "../../state/store";

import { InlineSampleComponent } from "./InlineSampleDisplay";
import styles from "./SampleDetailComponent.module.css";
import {
  NavbarConfig,
  SampleNavbar,
  SampleNavigationConfig,
} from "./SampleNavbar";

export type { NavbarConfig, SampleNavigationConfig };

/**
 * Props for the SampleDetailComponent
 */
export interface SampleDetailComponentProps {
  /** The sample ID from URL params */
  sampleId: string | undefined;
  /** The epoch from URL params */
  epoch: string | undefined;
  /** The tab ID from URL params (for sample tabs like transcript, messages, etc.) */
  tabId: string | undefined;
  /** Navigation configuration for prev/next sample */
  navigation: SampleNavigationConfig;
  /** Navbar configuration for breadcrumb and back navigation */
  navbarConfig: NavbarConfig;
}

/**
 * Shared component for displaying sample details with navigation.
 * Used by both SampleDetailView (for /samples route) and LogSampleDetailView (for /logs route).
 *
 * This component handles:
 * - Keyboard shortcuts (arrow keys for nav, Ctrl+F for find)
 * - Find band integration
 * - Sample tab synchronization (URL → state)
 * - Navigation controls UI (prev/next buttons + sample info)
 * - Sample content rendering via InlineSampleComponent
 *
 * The parent component is responsible for:
 * - Loading hooks (useLoadLog, useLoadSample, usePollSample)
 * - Calculating navigation state
 * - Navigation callbacks
 * - Cleanup on unmount
 */
export const SampleDetailComponent: FC<SampleDetailComponentProps> = ({
  sampleId,
  epoch,
  tabId,
  navigation,
  navbarConfig,
}) => {
  const { onPrevious, onNext, hasPrevious, hasNext } = navigation;

  // Sample data and status
  const sampleData = useSampleData();
  const sample = useMemo(() => {
    return sampleData.getSelectedSample();
  }, [sampleData]);
  const sampleStatus = useStore((state) => state.sample.sampleStatus);

  // Returns true when sample is undefined (no stale data to worry about —
  // this is normal for running samples where data comes via runningEvents).
  const sampleMatchesRequest = useMemo(() => {
    if (!sampleId || !epoch) return false;
    if (!sample) return true;
    return (
      String(sample.id) === sampleId && sample.epoch === parseInt(epoch, 10)
    );
  }, [sample, sampleId, epoch]);

  // Find functionality
  const showFind = useStore((state) => state.app.showFind);
  const setShowFind = useStore((state) => state.appActions.setShowFind);
  const hideFind = useStore((state) => state.appActions.hideFind);
  const nativeFind = useStore((state) => state.app.nativeFind);

  // Sample tab synchronization
  const setSampleTab = useStore((state) => state.appActions.setSampleTab);

  useEffect(() => {
    // Set the sample tab if specified in the URL
    if (tabId) {
      setSampleTab(tabId);
    }
  }, [tabId, setSampleTab]);

  // Global keydown handler for keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: globalThis.KeyboardEvent) => {
      // Don't handle keyboard events if focus is on an input, textarea, or
      // select element. Walk shadow roots so custom elements like
      // <vscode-textarea> (whose real <textarea> lives in shadow DOM) count.
      let activeElement: Element | null = document.activeElement;
      while (activeElement?.shadowRoot?.activeElement) {
        activeElement = activeElement.shadowRoot.activeElement;
      }
      const isInputFocused =
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.tagName === "SELECT" ||
          (activeElement instanceof HTMLElement &&
            activeElement.isContentEditable));

      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        if (!nativeFind) {
          e.preventDefault();
          e.stopPropagation();
          setShowFind(true);
        }
      } else if (e.key === "Escape") {
        if (!nativeFind) {
          hideFind();
        }
      } else if (!isInputFocused) {
        // Navigation shortcuts (only when not in an input field)
        if (e.key === "ArrowLeft") {
          if (hasPrevious) {
            e.preventDefault();
            onPrevious();
          }
        } else if (e.key === "ArrowRight") {
          if (hasNext) {
            e.preventDefault();
            onNext();
          }
        }
      }
    },
    [
      setShowFind,
      hideFind,
      hasPrevious,
      hasNext,
      nativeFind,
      onPrevious,
      onNext,
    ]
  );

  useEffect(() => {
    // Use capture phase to catch event before it reaches other handlers
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handleKeyDown]);

  return (
    <ExtendedFindProvider>
      <FindTargetProvider>
        {showFind ? <FindBand /> : ""}
        <div className={styles.detail}>
          <SampleNavbar
            sampleId={sampleId}
            epoch={epoch}
            navigation={navigation}
            navbarConfig={navbarConfig}
          />

          {sampleMatchesRequest && (
            <InlineSampleComponent
              showActivity={
                sampleStatus === "loading" || sampleStatus === "streaming"
              }
              className={styles.panel}
            />
          )}
        </div>
      </FindTargetProvider>
    </ExtendedFindProvider>
  );
};
