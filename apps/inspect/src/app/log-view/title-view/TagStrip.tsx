import { FC } from "react";

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
 * The chip strip is a single wrap-aware flex container — chips followed
 * by the Edit pill as the last item, matching the Task tab. When chips
 * wrap to additional lines, the Edit pill follows the last chip onto
 * whichever line it lands on.
 */
export const TagStrip: FC<TagStripProps> = ({ tags, showEdit, onEdit }) => {
  if (tags.length === 0 && !showEdit) return null;
  return (
    <div className={styles.tagRow}>
      {tags.map((tag) => (
        <TagChip key={tag} label={tag} />
      ))}
      {showEdit && (
        <EditButton onClick={onEdit} title="Edit tags" variant="pill">
          Tags
        </EditButton>
      )}
    </div>
  );
};
