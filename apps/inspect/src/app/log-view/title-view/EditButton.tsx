import clsx from "clsx";
import { FC } from "react";

import { ApplicationIcons } from "../../appearance/icons";

import styles from "./EditButton.module.css";

interface EditButtonProps {
  onClick: () => void;
  title?: string;
  // "link"  — link-blue text, no border (used in card headers).
  // "pill"  — matches TagChip's outline-only style so the button can
  //           sit beside chips without standing out.
  variant?: "link" | "pill";
}

// Compact pencil-prefixed Edit button used wherever an Edit affordance is
// surfaced (inline tag row + metadata card header).
export const EditButton: FC<EditButtonProps> = ({
  onClick,
  title,
  variant = "link",
}) => (
  <button
    type="button"
    className={clsx(
      styles.button,
      variant === "pill" ? styles.pill : styles.link,
      "text-size-smaller"
    )}
    onClick={onClick}
    title={title ?? "Edit"}
  >
    <i className={ApplicationIcons.pencil} />
    Edit
  </button>
);
