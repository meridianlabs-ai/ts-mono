import clsx from "clsx";
import {
  ChangeEvent,
  FC,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { MetadataEdit } from "@tsmono/inspect-common/types";

import { Modal } from "../../../components/Modal";
import { useStore } from "../../../state/store";
import { ApplicationIcons } from "../../appearance/icons";

import { AutogrowText } from "./AutogrowText";
import { ChangeSummary } from "./ChangeSummary";
import sharedStyles from "./EditAnnotationsDialog.module.css";
import styles from "./EditMetadataDialog.module.css";
import { formatEditError } from "./editErrors";
import { ProvenanceFields } from "./ProvenanceFields";

type NewType = "string" | "number" | "boolean" | "object" | "array" | "null";

interface MetaEntry {
  key: string;
  // String form used in the textarea. We persist as a string and parse on
  // save so users can type plain text or JSON freely.
  text: string;
  isNew?: boolean;
  // Whether the value text has been touched since the row was loaded /
  // added. Used to drive the "Editing" change-summary line.
  dirty?: boolean;
}

interface EditMetadataDialogProps {
  showing: boolean;
  setShowing: (showing: boolean) => void;
  currentMetadata: Record<string, unknown>;
  logFile: string;
  onSaved?: () => void;
}

// Serialize any metadata value to its on-the-wire string form for editing.
// Strings stay as-is (no quotes); everything else is JSON-stringified so
// users can edit it as text. The reverse is applied on save.
const toEditableString = (v: unknown): string => {
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
};

// Reverse of toEditableString. JSON.parse covers true/false/null/numbers/
// arrays/objects; bare strings (the only thing JSON.parse refuses) round-
// trip as the raw text the user typed.
const parseOrRaw = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const seedFor = (type: NewType): unknown => {
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "object":
      return {};
    case "array":
      return [];
    case "null":
      return null;
  }
};

export const EditMetadataDialog: FC<EditMetadataDialogProps> = ({
  showing,
  setShowing,
  currentMetadata,
  logFile,
  onSaved,
}) => {
  const api = useStore((state) => state.api);

  const initialEntries = useMemo<MetaEntry[]>(
    () =>
      Object.entries(currentMetadata).map(([key, value]) => ({
        key,
        text: toEditableString(value),
      })),
    [currentMetadata]
  );

  const [entries, setEntries] = useState<MetaEntry[]>(initialEntries);
  const [removed, setRemoved] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<NewType>("string");
  const [author, setAuthor] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!showing) return;
    setEntries(initialEntries);
    setRemoved([]);
    setNewKey("");
    setNewType("string");
    setAuthor("");
    setReason("");
    setSubmitting(false);
    setError(undefined);

    // Prefill Author from the server's best-effort identity (git
    // user.name → OS login). Same pattern as EditTagsDialog.
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
          /* author stays blank — user can fill in manually */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [showing, initialEntries, api]);

  const existingKeys = useMemo(
    () => new Set(entries.map((e) => e.key)),
    [entries]
  );

  const adding = entries.filter((e) => e.isNew).map((e) => e.key);
  const editing = entries
    .filter((e) => e.dirty && !e.isNew)
    .map((e) => e.key);
  const hasChanges =
    adding.length > 0 || editing.length > 0 || removed.length > 0;

  const updateValue = useCallback((key: string, text: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.key === key ? { ...e, text, dirty: true } : e))
    );
  }, []);

  const removeKey = useCallback((key: string) => {
    setEntries((prev) => {
      const entry = prev.find((e) => e.key === key);
      if (!entry) return prev;
      if (!entry.isNew) {
        setRemoved((r) => (r.includes(key) ? r : [...r, key]));
      }
      return prev.filter((e) => e.key !== key);
    });
  }, []);

  const addKey = () => {
    const k = newKey.trim();
    if (!k) return;
    if (existingKeys.has(k)) {
      // duplicate — silently no-op (matches design intent)
      setNewKey("");
      return;
    }
    const wasPreviouslyRemoved = removed.includes(k);
    if (wasPreviouslyRemoved) {
      setRemoved((r) => r.filter((x) => x !== k));
    }
    setEntries((prev) => [
      ...prev,
      {
        key: k,
        text: toEditableString(seedFor(newType)),
        isNew: true,
        dirty: true,
      },
    ]);
    setNewKey("");
    setNewType("string");
  };

  const handleNewKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKey();
    }
  };

  const canSave =
    !submitting && hasChanges && author.trim().length > 0 && !!api?.edit_log;

  const handleSave = async () => {
    if (!canSave || !api?.edit_log) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const metadata_set: Record<string, unknown> = {};
      for (const entry of entries) {
        if (entry.isNew || entry.dirty) {
          metadata_set[entry.key] = parseOrRaw(entry.text);
        }
      }
      const edit: MetadataEdit = {
        type: "metadata",
        metadata_set,
        metadata_remove: removed,
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
      id="edit-metadata-dialog"
      showing={showing}
      setShowing={setShowing}
      title="Edit metadata"
      width="820px"
      footer={
        <div className={sharedStyles.footer}>
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
      }
    >
      <div className={sharedStyles.body}>
        <div className={sharedStyles.section}>
          <div className={sharedStyles.labelRow}>
            <label className={clsx("text-size-smaller", sharedStyles.label)}>
              Metadata
            </label>
            <span className={clsx("text-size-smaller", sharedStyles.hint)}>
              Values are edited as plain text. Use JSON syntax for nested
              values.
            </span>
          </div>

          <div className={styles.table}>
            {entries.length === 0 && (
              <div className={clsx("text-size-smaller", styles.empty)}>
                No metadata yet — add a key below.
              </div>
            )}
            {entries.map((entry, idx) => (
              <MetaRow
                key={entry.key}
                entry={entry}
                first={idx === 0}
                onChange={(text) => updateValue(entry.key, text)}
                onRemove={() => removeKey(entry.key)}
                disabled={submitting}
              />
            ))}
          </div>

          <ChangeSummary
            adding={adding}
            editing={editing}
            removing={removed}
          />

          <div className={styles.addRow}>
            <input
              type="text"
              className={clsx(
                "form-control",
                "text-size-smaller",
                styles.addKeyInput
              )}
              placeholder="Add a key…"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={handleNewKeyDown}
              disabled={submitting}
            />
            <select
              className={clsx(
                "form-select",
                "text-size-smaller",
                styles.typeSelect
              )}
              value={newType}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                setNewType(e.target.value as NewType)
              }
              aria-label="Type for new key"
              disabled={submitting}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="object">object</option>
              <option value="array">array</option>
              <option value="null">null</option>
            </select>
            <button
              type="button"
              className={clsx(
                "btn",
                newKey.trim() ? "btn-primary" : "btn-secondary",
                "text-size-smaller",
                styles.addButton
              )}
              onClick={addKey}
              disabled={submitting || !newKey.trim()}
            >
              <i className={ApplicationIcons.changes.add} /> Add key
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

const MetaRow: FC<{
  entry: MetaEntry;
  first: boolean;
  onChange: (text: string) => void;
  onRemove: () => void;
  disabled?: boolean;
}> = ({ entry, first, onChange, onRemove, disabled }) => (
  <div
    className={clsx(
      styles.row,
      !first && styles.rowDivider,
      entry.isNew && styles.rowNew
    )}
  >
    <code className={clsx("text-size-smaller", styles.key)}>{entry.key}</code>
    <div className={styles.value}>
      <AutogrowText
        value={entry.text}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
    <button
      type="button"
      className={styles.remove}
      onClick={onRemove}
      title={`Remove ${entry.key}`}
      aria-label={`Remove ${entry.key}`}
      disabled={disabled}
    >
      <i className={ApplicationIcons.trash} />
    </button>
  </div>
);
