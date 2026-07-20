import clsx from "clsx";
import React, { FC, useCallback } from "react";

import { useArrowStepper } from "@tsmono/react/hooks";

import { ApplicationIcons } from "../appearance/icons";
import { ApplicationNavbar } from "../navbar/ApplicationNavbar";

import styles from "./SampleNavbar.module.css";

export interface SampleNavigationConfig {
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface NavbarConfig {
  currentPath: string | undefined;
  fnNavigationUrl: (file: string, log_dir?: string) => string;
  /** Override the back button's target (default: parent of currentPath). */
  backUrl?: string;
  /** Override the home button's target (default: root listing). */
  homeUrl?: string;
  bordered?: boolean;
  breadcrumbsEnabled?: boolean;
}

interface SampleNavbarProps {
  sampleId: string | undefined;
  epoch: string | undefined;
  navigation: SampleNavigationConfig;
  navbarConfig: NavbarConfig;
  /** Extra loading signal for the navbar's activity bar (e.g. this sample
   *  still loading), ORed with the selected log's own loading state. */
  loading?: boolean;
}

/**
 * The global header bar shown above a sample's content: the breadcrumb /
 * theme / options chrome (ApplicationNavbar) plus the prev/next sample
 * controls. Shared by the sample detail view and the single-event focus page.
 */
export const SampleNavbar: FC<SampleNavbarProps> = ({
  sampleId,
  epoch,
  navigation,
  navbarConfig,
  loading,
}) => {
  const { onPrevious, onNext, hasPrevious, hasNext } = navigation;
  const {
    currentPath,
    fnNavigationUrl,
    backUrl,
    homeUrl,
    bordered = true,
    breadcrumbsEnabled,
  } = navbarConfig;

  const handleNavButtonKeyDown = useCallback(
    (e: React.KeyboardEvent, action: () => void, enabled: boolean) => {
      if ((e.key === "Enter" || e.key === " ") && enabled) {
        e.preventDefault();
        action();
      }
    },
    []
  );

  // Bound here, next to the "(←)"/"(→)" tooltips it backs, so every surface
  // that renders this navbar (sample detail, single-event focus page) gets the
  // same sample-stepping binding.
  useArrowStepper({
    onPrev: onPrevious,
    onNext,
    canPrev: hasPrevious,
    canNext: hasNext,
  });

  return (
    <ApplicationNavbar
      currentPath={currentPath}
      fnNavigationUrl={fnNavigationUrl}
      backUrl={backUrl}
      homeUrl={homeUrl}
      bordered={bordered}
      breadcrumbsEnabled={breadcrumbsEnabled}
      loading={loading}
    >
      <div className={clsx(styles.sampleNav)}>
        <div
          onClick={hasPrevious ? onPrevious : undefined}
          onKeyDown={(e) => handleNavButtonKeyDown(e, onPrevious, hasPrevious)}
          tabIndex={hasPrevious ? 0 : -1}
          role="button"
          aria-label="Previous sample"
          title="Previous sample (←)"
          aria-disabled={!hasPrevious}
          className={clsx(!hasPrevious && styles.disabled, styles.nav)}
        >
          <i className={clsx(ApplicationIcons.previous)} />
        </div>
        <div className={clsx(styles.sampleInfo, "text-size-smallest")}>
          Sample {sampleId} (Epoch {epoch})
        </div>
        <div
          onClick={hasNext ? onNext : undefined}
          onKeyDown={(e) => handleNavButtonKeyDown(e, onNext, hasNext)}
          tabIndex={hasNext ? 0 : -1}
          role="button"
          aria-label="Next sample"
          title="Next sample (→)"
          aria-disabled={!hasNext}
          className={clsx(!hasNext && styles.disabled, styles.nav)}
        >
          <i className={clsx(ApplicationIcons.next)} />
        </div>
      </div>
    </ApplicationNavbar>
  );
};
