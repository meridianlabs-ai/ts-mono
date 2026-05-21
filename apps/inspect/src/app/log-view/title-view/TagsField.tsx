import { FC, useCallback, useState } from "react";

import { useRefreshLog } from "../../../state/hooks";
import { useStore } from "../../../state/store";

import { EditTagsDialog } from "./EditTagsDialog";
import { TagStrip } from "./TagStrip";

interface TagsFieldProps {
  tags: string[];
  className?: string;
}

/**
 * The full editable-tags surface: chip strip + Edit pill + dialog.
 *
 * Owns the store reads (edit capability, selected log, in-progress
 * status), the open/close state, and the refresh wiring. Renders
 * <TagStrip> for layout and <EditTagsDialog> behind it. Consumers just
 * pass the tag list and an optional className for layout context.
 *
 * The Edit affordance hides while the recorder is still appending — the
 * server returns 409 for edits on in-progress logs, and offering an
 * action only to fail on save is worse than not offering it.
 */
export const TagsField: FC<TagsFieldProps> = ({ tags, className }) => {
  const canEditTags = useStore((s) => Boolean(s.api?.edit_log));
  const selectedLogFile = useStore((s) => s.logs.selectedLogFile);
  const logStatus = useStore((s) => s.log.selectedLogDetails?.status);
  const refreshLog = useRefreshLog();
  const [editingTags, setEditingTags] = useState(false);
  const onTagsSaved = useCallback(() => refreshLog(), [refreshLog]);

  const isInProgress = logStatus === "started";
  const showEdit = canEditTags && !!selectedLogFile && !isInProgress;

  return (
    <>
      <TagStrip
        tags={tags}
        showEdit={showEdit}
        onEdit={() => setEditingTags(true)}
        className={className}
      />
      {selectedLogFile && (
        <EditTagsDialog
          showing={editingTags}
          setShowing={setEditingTags}
          currentTags={tags}
          logFile={selectedLogFile}
          onSaved={onTagsSaved}
        />
      )}
    </>
  );
};
