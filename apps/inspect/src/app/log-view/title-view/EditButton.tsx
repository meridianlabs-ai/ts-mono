import clsx from "clsx";
import { FC } from "react";

import { ApplicationIcons } from "../../appearance/icons";

import styles from "./EditButton.module.css";

interface EditButtonProps {
  onClick: () => void;
  title?: string;
}

// Compact pencil-prefixed Edit button used wherever an Edit affordance is
// surfaced (inline tag row + metadata card header).
export const EditButton: FC<EditButtonProps> = ({ onClick, title }) => (
  <button
    type="button"
    className={clsx(styles.button, "text-size-smaller")}
    onClick={onClick}
    title={title ?? "Edit"}
  >
    <i className={ApplicationIcons.pencil} />
    Edit
  </button>
);
