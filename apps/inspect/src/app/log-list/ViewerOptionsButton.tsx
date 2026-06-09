import clsx from "clsx";
import { forwardRef, useCallback } from "react";

import { ApplicationIcons } from "../appearance/icons";

import styles from "./ViewerOptionsButton.module.css";

export interface ViewerOptionsButtonProps {
  showing: boolean;
  setShowing: (showing: boolean) => void;
  error?: Error;
}

export const ViewerOptionsButton = forwardRef<
  HTMLButtonElement,
  ViewerOptionsButtonProps
>(({ showing, setShowing, error }, ref) => {
  const toggleShowing = useCallback(() => {
    setShowing(!showing);
  }, [showing, setShowing]);

  return (
    <div className={styles.wrapper}>
      <button
        ref={ref}
        type="button"
        className={clsx(styles.button)}
        onClick={toggleShowing}
        title={
          error
            ? `Sync error: ${error.message}`
            : "Viewer information and options"
        }
      >
        <i className={clsx(ApplicationIcons.config, styles.viewerOptions)} />
        {error && <span className={styles.errorDot} aria-hidden="true" />}
      </button>
    </div>
  );
});

ViewerOptionsButton.displayName = "ViewerOptionsButton";
