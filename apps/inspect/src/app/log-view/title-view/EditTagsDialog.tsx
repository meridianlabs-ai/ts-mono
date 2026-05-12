import clsx from "clsx";
import { FC, KeyboardEvent, useEffect, useMemo, useState } from "react";

import { TagsEdit } from "@tsmono/inspect-common/types";

import { ApiError } from "../../../client/api/view-server/request";
import { Modal } from "../../../components/Modal";
import { useStore } from "../../../state/store";
import { ApplicationIcons } from "../../appearance/icons";

import styles from "./EditTagsDialog.module.css";

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
  const api = useStore((state) => state.api);

  const [tags, setTags] = useState<string[]>(currentTags);
  const [pending, setPending] = useState("");
  const [author, setAuthor] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Reset local state whenever the dialog opens (or the underlying log
  // changes its tags out from under us).
  useEffect(() => {
    if (showing) {
      setTags(currentTags);
      setPending("");
      setAuthor("");
      setReason("");
      setError(undefined);
      setSubmitting(false);
    }
  }, [showing, currentTags]);

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
  const hasChanges = tagsAdd.length > 0 || tagsRemove.length > 0;

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
      // comma also commits, matches common chip-input UX
      e.preventDefault();
      addPendingTag();
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const canSave =
    !submitting && hasChanges && author.trim().length > 0 && !!api?.edit_log;

  const handleSave = async () => {
    if (!canSave || !api?.edit_log) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const edit: TagsEdit = {
        type: "tags",
        tags_add: tagsAdd,
        tags_remove: tagsRemove,
      };
      await api.edit_log(logFile, {
        edits: [edit],
        provenance: {
          author: author.trim(),
          reason: reason.trim() || undefined,
          metadata: {},
          timestamp: new Date().toISOString(),
        },
      });
      setShowing(false);
      onSaved?.();
    } catch (err) {
      setError(formatError(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      id="edit-tags-dialog"
      showing={showing}
      setShowing={setShowing}
      title="Edit tags"
    >
      <div className={styles.body}>
        <div className={styles.section}>
          <label className={clsx("text-size-smaller", styles.label)}>
            Tags
          </label>
          <div className={styles.tagsRow}>
            {tags.length === 0 && (
              <span className={clsx("text-size-smaller", styles.empty)}>
                No tags yet — add one below.
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag}
                className={clsx("text-size-smaller", styles.chip, {
                  [styles.chipNew]: !initialSet.has(tag),
                })}
              >
                {tag}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => removeTag(tag)}
                >
                  <i className={ApplicationIcons.close} />
                </button>
              </span>
            ))}
          </div>
          <div className={styles.addRow}>
            <input
              type="text"
              className={clsx("form-control", "text-size-smaller", styles.input)}
              placeholder="Add a tag and press Enter"
              value={pending}
              onChange={(e) => setPending(e.target.value)}
              onKeyDown={handleInputKeyDown}
              disabled={submitting}
              autoFocus
            />
            <button
              type="button"
              className={clsx("btn", "btn-secondary", "text-size-smaller")}
              onClick={addPendingTag}
              disabled={submitting || !pending.trim()}
            >
              <i className={ApplicationIcons.changes.add} /> Add
            </button>
          </div>
          {tagsRemove.length > 0 && (
            <div className={clsx("text-size-smaller", styles.removedNote)}>
              Removing: {tagsRemove.join(", ")}
            </div>
          )}
        </div>

        <div className={styles.section}>
          <label
            className={clsx("text-size-smaller", styles.label)}
            htmlFor="edit-tags-author"
          >
            Author <span className={styles.required}>*</span>
          </label>
          <input
            id="edit-tags-author"
            type="text"
            className={clsx("form-control", "text-size-smaller")}
            placeholder="Your name or username"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            disabled={submitting}
          />
        </div>

        <div className={styles.section}>
          <label
            className={clsx("text-size-smaller", styles.label)}
            htmlFor="edit-tags-reason"
          >
            Reason
          </label>
          <input
            id="edit-tags-reason"
            type="text"
            className={clsx("form-control", "text-size-smaller")}
            placeholder="Optional — why this edit?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={submitting}
          />
        </div>

        {error && (
          <div className={clsx("text-size-smaller", styles.error)}>{error}</div>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={clsx("btn", "btn-secondary", "text-size-smaller")}
            onClick={() => setShowing(false)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={clsx("btn", "btn-primary", "text-size-smaller")}
            onClick={handleSave}
            disabled={!canSave}
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
};

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 412) {
      return "This log was modified by someone else. Please reload and try again.";
    }
    if (err.status === 400) {
      return err.message.replace(/^API Error 400:\s*/, "");
    }
    return err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
