import clsx from "clsx";
import { ComponentProps, FC, ReactNode, useRef, useState } from "react";

import { MetadataEdit, TagsEdit } from "@tsmono/inspect-common/types";
import { Modal } from "@tsmono/react/components";

import { getApi } from "../../../app_config";
import { useUserInfo } from "../../server/useUserInfo";

import { ChangeSummary } from "./ChangeSummary";
import styles from "./EditAnnotationsDialog.module.css";
import { formatEditError } from "./editErrors";

interface EditAnnotationsDialogProps {
  id: string;
  title: string;
  width: string;
  showing: boolean;
  setShowing: (showing: boolean) => void;
  logFile: string;
  onSaved?: () => void;
  changes: ComponentProps<typeof ChangeSummary>;
  // May throw; the error is shown via formatEditError.
  buildEdit: () => TagsEdit | MetadataEdit;
  children: (submitting: boolean) => ReactNode;
}

/**
 * The provenance fields, change summary, and save flow shared by the tags
 * and metadata editors. The editor itself is `children`.
 */
export const EditAnnotationsDialog: FC<EditAnnotationsDialogProps> = ({
  id,
  title,
  width,
  showing,
  setShowing,
  logFile,
  onSaved,
  changes,
  buildEdit,
  children,
}) => {
  const api = getApi();

  // Undefined until the user types, so the server identity fills the field.
  const [authorEdit, setAuthorEdit] = useState<string | undefined>();
  const userInfo = useUserInfo(showing);
  const author = authorEdit ?? userInfo.data?.name ?? "";
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Render-adjust rather than an effect so the reset lands before paint.
  const [prevShowing, setPrevShowing] = useState(showing);
  if (prevShowing !== showing) {
    setPrevShowing(showing);
    if (showing) {
      setAuthorEdit(undefined);
      setReason("");
      setError(undefined);
      setSubmitting(false);
    }
  }

  const { adding = [], editing = [], removing = [] } = changes;
  const hasChanges =
    adding.length > 0 || editing.length > 0 || removing.length > 0;
  const canSave =
    !submitting && hasChanges && author.trim().length > 0 && !!api.edit_log;

  // Guards against a second click before the first save settles; a ref so
  // it updates synchronously.
  const inFlightRef = useRef(false);

  const handleSave = (): void => {
    // Hoisted to a const so the narrowing survives into the chain callbacks.
    const editLog = api.edit_log;
    if (!canSave || inFlightRef.current || !editLog) return;
    inFlightRef.current = true;
    // The previous error is left in place rather than cleared: clearing and
    // re-setting the same message on a quick failure made it flash. A
    // successful save closes the dialog, and reopening resets it.
    // The indicator is delayed so a save that fails almost immediately
    // (server unreachable) doesn't flash "Saving…".
    const indicatorTimer = window.setTimeout(() => setSubmitting(true), 200);
    const provenance = {
      author: author.trim(),
      reason: reason.trim() || undefined,
      metadata: {},
      timestamp: new Date().toISOString(),
    };
    // buildEdit runs inside the chain so a throw lands in the catch below.
    Promise.resolve()
      .then(() => editLog(logFile, { edits: [buildEdit()], provenance }))
      .then(() => {
        setShowing(false);
        onSaved?.();
      })
      .catch((err: unknown) => setError(formatEditError(err)))
      .finally(() => {
        window.clearTimeout(indicatorTimer);
        setSubmitting(false);
        inFlightRef.current = false;
      });
  };

  return (
    <Modal
      id={id}
      show={showing}
      onHide={() => setShowing(false)}
      title={title}
      width={width}
      footer={
        <div className={styles.footer}>
          <ChangeSummary {...changes} />
          <div className={styles.footerActions}>
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
      <div className={styles.body}>
        {children(submitting)}

        <hr className={styles.divider} />

        <div className={styles.provenance}>
          <div className={styles.section}>
            <label
              className={clsx("text-size-smaller", styles.label)}
              htmlFor="edit-annotations-author"
            >
              Author <span className={styles.required}>*</span>
            </label>
            <input
              id="edit-annotations-author"
              type="text"
              className={clsx("form-control", "text-size-smaller")}
              placeholder="Your name or username"
              value={author}
              onChange={(e) => setAuthorEdit(e.target.value)}
              disabled={submitting}
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
              <span className={clsx("text-size-smaller", styles.hint)}>
                optional
              </span>
            </div>
            <input
              id="edit-annotations-reason"
              type="text"
              className={clsx("form-control", "text-size-smaller")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        {error && (
          <div className={clsx("text-size-smaller", styles.error)}>{error}</div>
        )}
      </div>
    </Modal>
  );
};
