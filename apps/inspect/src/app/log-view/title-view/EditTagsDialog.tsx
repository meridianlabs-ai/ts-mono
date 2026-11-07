import clsx from "clsx";
import { FC, KeyboardEvent, useMemo, useState } from "react";

import { Icon } from "@tsmono/react/icons";

import { EditAnnotationsDialog } from "./EditAnnotationsDialog";
import sharedStyles from "./EditAnnotationsDialog.module.css";
import styles from "./EditTagsDialog.module.css";
import { TagChip } from "./TagChip";

interface EditTagsDialogProps {
  showing: boolean;
  setShowing: (showing: boolean) => void;
  currentTags: string[];
  logFile: string;
  onSaved?: () => void;
}

export const EditTagsDialog: FC<EditTagsDialogProps> = ({
  showing,
  setShowing,
  currentTags,
  logFile,
  onSaved,
}) => {
  const [tags, setTags] = useState<string[]>(currentTags);
  const [pending, setPending] = useState("");

  // Reset whenever the dialog opens (or the log's tags change under us).
  // Render-adjust rather than an effect so the reset lands before paint.
  const [prevReset, setPrevReset] = useState({ showing, currentTags });
  if (prevReset.showing !== showing || prevReset.currentTags !== currentTags) {
    setPrevReset({ showing, currentTags });
    if (showing) {
      setTags(currentTags);
      setPending("");
    }
  }

  const initialSet = useMemo(() => new Set(currentTags), [currentTags]);
  const currentSet = useMemo(() => new Set(tags), [tags]);

  const tagsAdd = useMemo(
    () => tags.filter((t) => !initialSet.has(t)),
    [tags, initialSet]
  );
  const tagsRemove = useMemo(
    () => currentTags.filter((t) => !currentSet.has(t)),
    [currentTags, currentSet]
  );

  const addPendingTag = () => {
    const next = pending.trim();
    if (!next) return;
    if (currentSet.has(next)) {
      setPending("");
      return;
    }
    setTags((prev) => [...prev, next]);
    setPending("");
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addPendingTag();
    } else if (e.key === "," && pending.trim()) {
      e.preventDefault();
      addPendingTag();
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  return (
    <EditAnnotationsDialog
      id="edit-tags-dialog"
      title="Edit tags"
      width="580px"
      showing={showing}
      setShowing={setShowing}
      logFile={logFile}
      onSaved={onSaved}
      changes={{ adding: tagsAdd, removing: tagsRemove }}
      buildEdit={() => ({
        type: "tags",
        tags_add: tagsAdd,
        tags_remove: tagsRemove,
      })}
    >
      {(submitting) => (
        <div className={sharedStyles.section}>
          {/* Names the chip box, so it can't be a <label> — those may only
              point at a single form control. */}
          <span
            id="edit-tags-label"
            className={clsx("text-size-smaller", sharedStyles.label)}
          >
            Tags
          </span>
          <div
            className={styles.chipBox}
            role="group"
            aria-labelledby="edit-tags-label"
          >
            {tags.length === 0 && (
              <span className={clsx("text-size-smaller", styles.empty)}>
                No tags yet — add one below.
              </span>
            )}
            {tags.map((tag) => (
              <TagChip
                key={tag}
                label={tag}
                isNew={!initialSet.has(tag)}
                onRemove={() => removeTag(tag)}
              />
            ))}
          </div>
          <div className={styles.addRow}>
            <input
              type="text"
              className={clsx(
                "form-control",
                "text-size-smaller",
                styles.input
              )}
              placeholder="Add a tag and press Enter"
              value={pending}
              onChange={(e) => setPending(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={submitting}
              data-autofocus
            />
            <button
              type="button"
              className={clsx(
                "btn",
                pending.trim() ? "btn-primary" : "btn-secondary",
                "text-size-smaller",
                styles.addButton
              )}
              onClick={addPendingTag}
              disabled={submitting || !pending.trim()}
            >
              <Icon name="changeAdd" /> Add
            </button>
          </div>
        </div>
      )}
    </EditAnnotationsDialog>
  );
};
