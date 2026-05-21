import clsx from "clsx";
import { FC, KeyboardEvent, useEffect, useMemo, useState } from "react";

import { TagsEdit } from "@tsmono/inspect-common/types";

import { Modal } from "../../../components/Modal";
import { useStore } from "../../../state/store";
import { ApplicationIcons } from "../../appearance/icons";

import { ChangeSummary } from "./ChangeSummary";
import sharedStyles from "./EditAnnotationsDialog.module.css";
import styles from "./EditTagsDialog.module.css";
import { formatEditError } from "./editErrors";
import { ProvenanceFields } from "./ProvenanceFields";
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
  const api = useStore((state) => state.api);

  const [tags, setTags] = useState<string[]>(currentTags);
  const [pending, setPending] = useState("");
  const [author, setAuthor] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Reset local state whenever the dialog opens (or the underlying log
  // changes its tags out from under us). On open, also fetch the
  // server-side identity (git user.name → OS login) so the user doesn't
  // have to retype themselves for every edit. The fetch is best-effort —
  // a missing endpoint or empty result simply leaves the field blank.
  useEffect(() => {
    if (!showing) return;
    setTags(currentTags);
    setPending("");
    setAuthor("");
    setReason("");
    setError(undefined);
    setSubmitting(false);

    let cancelled = false;
    if (api?.get_user_info) {
      api
        .get_user_info()
        .then((info) => {
          if (!cancelled && info.name) {
            setAuthor((current) => current || info.name || "");
          }
        })
        .catch(() => {
          /* ignore — author stays blank, user can fill in manually */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [showing, currentTags, api]);

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
      setError(formatEditError(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      id="edit-tags-dialog"
      showing={showing}
      setShowing={setShowing}
      title="Edit tags"
      width="580px"
      footer={
        <div className={sharedStyles.footer}>
          <ChangeSummary adding={tagsAdd} removing={tagsRemove} />
          <div className={sharedStyles.footerActions}>
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
      }
    >
      <div className={sharedStyles.body}>
        <div className={sharedStyles.section}>
          <label className={clsx("text-size-smaller", sharedStyles.label)}>
            Tags
          </label>
          <div className={styles.chipBox}>
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
              autoFocus
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
              <i className={ApplicationIcons.changes.add} /> Add
            </button>
          </div>
        </div>

        <hr className={sharedStyles.divider} />

        <ProvenanceFields
          author={author}
          setAuthor={setAuthor}
          reason={reason}
          setReason={setReason}
          disabled={submitting}
        />

        {error && (
          <div className={clsx("text-size-smaller", sharedStyles.error)}>
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
};
