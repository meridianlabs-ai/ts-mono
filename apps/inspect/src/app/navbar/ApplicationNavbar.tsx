import { FC, ReactNode, useMemo, useState } from "react";

import {
  ThemeToggle,
  useResolvedIsDark,
} from "@tsmono/inspect-components/theme";
import { isVscode } from "@tsmono/util";

import { ActivityBar } from "../../components/ActivityBar";
import { useSelectedLogLoading } from "../../state/selectedLogDetails";
import { useStore } from "../../state/store";
import { useUserSettings } from "../../state/userSettings";
import { ViewerOptionsButton } from "../log-list/ViewerOptionsButton";
import { ViewerOptionsPopover } from "../log-list/ViewerOptionsPopover";

import { Navbar } from "./Navbar";

interface ApplicationNavbarProps {
  currentPath: string | undefined;
  fnNavigationUrl: (file: string, log_dir?: string) => string;
  bordered?: boolean;
  children?: ReactNode;
  showActivity?: "all" | "sample" | "log";
  breadcrumbsEnabled?: boolean;
}

export const ApplicationNavbar: FC<ApplicationNavbarProps> = ({
  currentPath,
  fnNavigationUrl,
  bordered,
  children,
  showActivity = "log",
  breadcrumbsEnabled,
}) => {
  const [optionsEl, setOptionsEl] = useState<HTMLButtonElement | null>(null);
  const themePreference = useUserSettings((s) => s.themePreference);
  const setThemePreference = useUserSettings((s) => s.setThemePreference);
  const isDark = useResolvedIsDark(themePreference);
  const loading = useSelectedLogLoading();
  const sampleStatus = useStore((state) => state.sample.sampleStatus);

  const isShowing = useStore((state) => state.app.dialogs.options);
  const setShowing = useStore(
    (state) => state.appActions.setShowingOptionsDialog
  );

  const hasActivity = useMemo(() => {
    if (showActivity === "all") {
      return loading || sampleStatus === "loading";
    } else if (showActivity === "log") {
      return loading;
    } else if (showActivity === "sample") {
      return sampleStatus === "loading";
    } else {
      return false;
    }
  }, [showActivity, loading, sampleStatus]);

  return (
    <div>
      <Navbar
        currentPath={currentPath}
        fnNavigationUrl={fnNavigationUrl}
        bordered={bordered}
        breadcrumbsEnabled={breadcrumbsEnabled}
      >
        {children}
        <ThemeToggle
          value={themePreference}
          isDark={isDark}
          onChange={setThemePreference}
          hideModeSwitch={isVscode()}
        />
        <ViewerOptionsButton
          showing={isShowing}
          setShowing={setShowing}
          ref={setOptionsEl}
        />
        <ViewerOptionsPopover
          positionEl={optionsEl}
          showing={isShowing}
          setShowing={setShowing}
        />
      </Navbar>
      <ActivityBar animating={hasActivity} />
    </div>
  );
};
