import { FC, ReactNode, useContext, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { dirname } from "@tsmono/util";

import { AppModeContext } from "../../App";
import { ApplicationIcons } from "../../icons";
import { scanRoute, scansRoute } from "../../router/url";
import { useStore } from "../../state/store";
import { ThemeToggleControl } from "../../theme/ThemeToggleControl";
import { useScanRoute } from "../hooks/useScanRoute";

import { EditablePath } from "./EditablePath";
import { Navbar } from "./Navbar";
import { NavButton } from "./NavButtons";

interface ScansNavbarProps {
  scansDir: string | null;
  scansDirSource?: "route" | "user" | "project" | "cli";
  setScansDir: (path: string) => void;
  children?: ReactNode;
  bordered?: boolean;
}

export const ScansNavbar: FC<ScansNavbarProps> = ({
  scansDir,
  scansDirSource,
  setScansDir,
  bordered = true,
  children,
}) => {
  const {
    relativePath,
    scanPath,
    scanResultUuid,
    scansDir: routeScansDir,
  } = useScanRoute();
  const singleFileMode = useStore((state) => state.singleFileMode);
  const [searchParams] = useSearchParams();
  // In workbench the ProjectBar already hosts the theme toggle; when embedded
  // (scans mode, e.g. in hawk) there's no ProjectBar, so surface the toggle in
  // this breadcrumb navbar instead.
  const appMode = useContext(AppModeContext);
  const showThemeToggle = appMode !== "workbench";

  // Check if we're on a scan result page and calculate the appropriate back URL
  const resolvedScansDir = routeScansDir || scansDir;

  const backUrl =
    resolvedScansDir && scanResultUuid
      ? scanRoute(resolvedScansDir, scanPath, searchParams)
      : !singleFileMode && resolvedScansDir
        ? scansRoute(resolvedScansDir, dirname(relativePath || ""))
        : undefined;

  const navButtons: NavButton[] = useMemo(() => {
    const buttons: NavButton[] = [];

    if (backUrl) {
      buttons.push({
        title: "Back",
        icon: ApplicationIcons.navbar.back,
        route: backUrl,
        enabled: !!scanPath,
      });
    }

    if (!singleFileMode && resolvedScansDir) {
      buttons.push({
        title: "Home",
        icon: ApplicationIcons.navbar.home,
        route: scansRoute(resolvedScansDir),
        enabled: !!scanPath,
      });
    }

    return buttons;
  }, [backUrl, singleFileMode, scanPath, resolvedScansDir]);

  return (
    <Navbar
      bordered={bordered}
      right={
        showThemeToggle ? (
          <>
            {children}
            <ThemeToggleControl />
          </>
        ) : (
          children
        )
      }
      leftButtons={navButtons.length > 0 ? navButtons : undefined}
      left={
        scansDir ? (
          <EditablePath
            path={scansDir}
            label="Scans"
            icon={
              scansDirSource === "cli" ? ApplicationIcons.terminal : undefined
            }
            title={
              scansDirSource === "cli"
                ? "Scans directory set via command line"
                : undefined
            }
            onPathChanged={setScansDir}
            placeholder="Select Scans Folder"
            className="text-size-smallest"
            editable={false}
          />
        ) : undefined
      }
    />
  );
};
