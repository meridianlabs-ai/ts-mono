import clsx from "clsx";
import { forwardRef, useCallback } from "react";

import { Icon } from "@tsmono/react/icons";

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
    <div>
      <button
        ref={ref}
        type="button"
        className={clsx(styles.button)}
        onClick={toggleShowing}
        aria-label="Viewer information and options"
        title={
          error
            ? `Listing refresh failed: ${error.message}`
            : "Viewer information and options"
        }
      >
        <Icon name="info" className={styles.viewerOptions} />
        {error && <Icon name="error" className={styles.errorAdornment} />}
      </button>
    </div>
  );
});

ViewerOptionsButton.displayName = "ViewerOptionsButton";
