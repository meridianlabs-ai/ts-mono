import { FC, useState } from "react";

import { useLogEditAffordance } from "../../../state/hooks";

import { EditTagsDialog } from "./EditTagsDialog";
import { TagStrip } from "./TagStrip";

interface TagsFieldProps {
  tags: string[];
  className?: string;
}

/**
 * The full editable-tags surface: chip strip + Edit pill + dialog.
 *
 * Edit gating, target log, and post-save refresh come from
 * `useLogEditAffordance`; this component owns only the open/close state
 * for its dialog. Consumers pass the tag list and an optional className
 * for layout context.
 */
export const TagsField: FC<TagsFieldProps> = ({ tags, className }) => {
  const { canEdit, selectedLogFile, refreshOnSave } = useLogEditAffordance();
  const [editingTags, setEditingTags] = useState(false);

  return (
    <>
      <TagStrip
        tags={tags}
        showEdit={canEdit}
        onEdit={() => setEditingTags(true)}
        className={className}
      />
      {selectedLogFile && (
        <EditTagsDialog
          showing={editingTags}
          setShowing={setEditingTags}
          currentTags={tags}
          logFile={selectedLogFile}
          onSaved={refreshOnSave}
        />
      )}
    </>
  );
};
