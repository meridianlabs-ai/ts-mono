import { clsx } from "clsx";
import { FC } from "react";
import { useLocation } from "react-router";

import { Icon } from "@tsmono/react/icons";

import { useLoggingNavigate } from "../../debugging/navigationDebugging";
import { getActivityByRoute } from "../../router/activities";
import { ThemeToggleControl } from "../../theme/ThemeToggleControl";
import { AppConfig } from "../../types/api-types";
import { appAliasedPath } from "../server/useAppConfig";

import styles from "./ProjectBar.module.css";

interface ProjectBarProps {
  config: AppConfig;
}

export const ProjectBar: FC<ProjectBarProps> = ({ config }) => {
  const navigate = useLoggingNavigate("ProjectBar");
  const location = useLocation();
  const currentActivity = getActivityByRoute(location.pathname);

  return (
    <div className={styles.projectBar}>
      <div className={styles.row}>
        <div className={styles.left}>
          <button
            type="button"
            className={clsx(styles.navButton, styles.historyButton)}
            onClick={() => navigate(-1)}
            aria-label="Back"
            title="Back"
          >
            <Icon name="navBack" />
          </button>
          <button
            type="button"
            className={clsx(styles.navButton, styles.historyButton)}
            onClick={() => navigate(1)}
            aria-label="Forward"
            title="Forward"
          >
            <Icon name="navForward" />
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={() => {
              if (currentActivity) {
                navigate(currentActivity.route);
              }
            }}
            aria-label="Home"
            title="Home"
          >
            <Icon name="navHome" />
          </button>
        </div>
        <span className={styles.center}>
          {appAliasedPath(config, config.project_dir)}
        </span>
        <div className={styles.right}>
          <ThemeToggleControl />
        </div>
      </div>
    </div>
  );
};
