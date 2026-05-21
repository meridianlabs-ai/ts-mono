import clsx from "clsx";
import { FC } from "react";

import { EditButton } from "./EditButton";
import { TagChip } from "./TagChip";
import styles from "./TagStrip.module.css";

interface TagStripProps {
  tags: string[];
  showEdit: boolean;
  onEdit: () => void;
  className?: string;
}

/**
 * Wrap-aware chip row: tag chips followed by the Edit pill as the last
 * item, so when chips wrap to additional lines the Edit pill follows the
 * last chip onto whichever line it lands on. Layout context (alignment,
 * margin, shrink) is supplied by the consumer via `className`.
 */
export const TagStrip: FC<TagStripProps> = ({
  tags,
  showEdit,
  onEdit,
  className,
}) => {
  if (tags.length === 0 && !showEdit) return null;
  return (
    <div className={clsx(styles.tagRow, className)}>
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
