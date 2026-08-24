import { clsx } from "clsx";
import { FC, useCallback } from "react";

import { ApplicationIcons } from "../app/appearance/icons";
import { useMessageVisibility } from "../state/hooks";

import styles from "./MessageBand.module.css";

interface MessageBandProps {
  id: string;
  message: string;
  scope?: "sample" | "eval";
  type: "info" | "warning" | "error";
}

const typeStyles: Record<MessageBandProps["type"], string> = {
  info: styles.info,
  warning: styles.warning,
  error: styles.error,
};

export const MessageBand: FC<MessageBandProps> = ({
  id,
  message,
  type,
  scope = "eval",
}) => {
  const [visible, setVisible] = useMessageVisibility(id, scope);
  const handleClick = useCallback(() => {
    setVisible(false);
  }, [setVisible]);

  return (
    <div
      className={clsx(
        styles.messageBand,
        typeStyles[type],
        !visible && styles.hidden
      )}
    >
      <i className={ApplicationIcons.logging[type]} />
      {message}
      <button
        type="button"
        className={clsx("btn", styles.messageBandBtn, typeStyles[type])}
        title="Close"
        onClick={handleClick}
      >
        <i className={ApplicationIcons.close}></i>
      </button>
    </div>
  );
};
