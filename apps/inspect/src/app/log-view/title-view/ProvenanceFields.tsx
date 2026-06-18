import clsx from "clsx";
import { FC } from "react";

import { Input } from "@tsmono/react/components";

import styles from "./EditAnnotationsDialog.module.css";

interface ProvenanceFieldsProps {
  author: string;
  setAuthor: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  disabled?: boolean;
}

export const ProvenanceFields: FC<ProvenanceFieldsProps> = ({
  author,
  setAuthor,
  reason,
  setReason,
  disabled,
}) => (
  <div className={styles.provenance}>
    <div className={styles.section}>
      <label
        className={clsx("text-size-smaller", styles.label)}
        htmlFor="edit-annotations-author"
      >
        Author <span className={styles.required}>*</span>
      </label>
      <Input
        id="edit-annotations-author"
        type="text"
        className={"text-size-smaller"}
        placeholder="Your name or username"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        disabled={disabled}
        aria-required="true"
      />
    </div>
    <div className={styles.section}>
      <div className={styles.labelRow}>
        <label
          className={clsx("text-size-smaller", styles.label)}
          htmlFor="edit-annotations-reason"
        >
          Reason
        </label>
        <span className={clsx("text-size-smaller", styles.hint)}>optional</span>
      </div>
      <Input
        id="edit-annotations-reason"
        type="text"
        className={"text-size-smaller"}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={disabled}
      />
    </div>
  </div>
);
