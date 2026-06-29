import clsx from "clsx";
import React, { FC, useCallback } from "react";

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
  bordered?: boolean;
  breadcrumbsEnabled?: boolean;
}

interface SampleNavbarProps {
  sampleId: string | undefined;
  epoch: string | undefined;
  navigation: SampleNavigationConfig;
  navbarConfig: NavbarConfig;
  showActivity?: "all" | "sample" | "log";
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
  showActivity,
}) => {
  const { onPrevious, onNext, hasPrevious, hasNext } = navigation;
  const {
    currentPath,
    fnNavigationUrl,
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

  return (
    <ApplicationNavbar
      currentPath={currentPath}
      fnNavigationUrl={fnNavigationUrl}
      bordered={bordered}
      breadcrumbsEnabled={breadcrumbsEnabled}
      showActivity={showActivity}
    >
      <div className={clsx(styles.sampleNav)}>
        <div
          onClick={hasPrevious ? onPrevious : undefined}
          onKeyDown={(e) => handleNavButtonKeyDown(e, onPrevious, hasPrevious)}
          tabIndex={hasPrevious ? 0 : -1}
          role="button"
          aria-label="Previous sample"
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
          aria-disabled={!hasNext}
          className={clsx(!hasNext && styles.disabled, styles.nav)}
        >
          <i className={clsx(ApplicationIcons.next)} />
        </div>
      </div>
    </ApplicationNavbar>
  );
};
