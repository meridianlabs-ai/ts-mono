import { FC, Fragment } from "react";

import { EditButton } from "./EditButton";
import styles from "./PrimaryBar.module.css";
import { TagChip } from "./TagChip";

interface TagStripProps {
  tags: string[];
  showEdit: boolean;
  onEdit: () => void;
}

/**
 * The inline tag chip block rendered in the viewer header.
 *
 * Lives as a Fragment of flex items inside the surrounding row
 * (`PrimaryBar`'s `bodyContainer`), not as a single wrapper element.
 * The `tagRow` div is wrap-aware so chips can overflow onto additional
 * lines, but the **Edit button is a sibling**, not a descendant — so
 * when chips wrap, the button stays anchored next to the chip block
 * instead of being pulled onto the wrap line with the last chip.
 */
export const TagStrip: FC<TagStripProps> = ({ tags, showEdit, onEdit }) => {
  if (tags.length === 0 && !showEdit) return null;
  return (
    <Fragment>
      {tags.length > 0 && (
        <span className={styles.tagSeparator} aria-hidden="true" />
      )}
      {tags.length > 0 && (
        <div className={styles.tagRow}>
          {tags.map((tag) => (
            <TagChip key={tag} label={tag} />
          ))}
        </div>
      )}
      {showEdit && (
        <EditButton onClick={onEdit} title="Edit tags" variant="pill" />
      )}
    </Fragment>
  );
};
