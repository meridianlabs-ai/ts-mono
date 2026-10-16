import clsx from "clsx";
import { forwardRef, useCallback } from "react";

import { Icon } from "@tsmono/react/icons";

import styles from "./ViewerOptionsButton.module.css";

export interface ViewerOptionsButtonProps {
  showing: boolean;
  setShowing: (showing: boolean) => void;
}

export const ViewerOptionsButton = forwardRef<
  HTMLButtonElement,
  ViewerOptionsButtonProps
>(({ showing, setShowing }, ref) => {
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
        title={"Viewer information and options"}
      >
        <Icon name="info" className={styles.viewerOptions} />
      </button>
    </div>
  );
});

ViewerOptionsButton.displayName = "ViewerOptionsButton";
