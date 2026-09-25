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
    <div>
      <button
        ref={ref}
        type="button"
        className={clsx(styles.button)}
        onClick={toggleShowing}
        title={
          error
            ? `Viewer information and options: ${error.message}`
            : "Viewer information and options"
        }
      >
        <i className={clsx(ApplicationIcons.info, styles.viewerOptions)} />
        {error && (
          <i
            className={clsx(ApplicationIcons.error, styles.errorAdornment)}
            aria-hidden="true"
          />
        )}
      </button>
    </div>
  );
});

ViewerOptionsButton.displayName = "ViewerOptionsButton";
