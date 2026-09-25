import { FC, memo, useState } from "react";

import {
  entriesOf,
  isExpandable,
  kindOf,
  previewOf,
  toClipboardJson,
  type ValueKind,
} from "./entries";
import styles from "./TreeNode.module.css";

const kindClass: Record<ValueKind, string> = {
  string: styles.string,
  number: styles.number,
  boolean: styles.boolean,
  null: styles.null,
  function: styles.function,
  collection: styles.collection,
  other: styles.other,
};

const CHUNK_SIZE = 100;
const COPIED_FEEDBACK_MS = 1000;

interface TreeNodeProps {
  name: string;
  value: unknown;
  defaultExpanded?: boolean;
}

const classes = (...names: (string | false | undefined)[]): string =>
  names.filter((n) => typeof n === "string").join(" ");

export const TreeNode: FC<TreeNodeProps> = memo(
  ({ name, value, defaultExpanded = false }) => {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [limit, setLimit] = useState(CHUNK_SIZE);
    const [copied, setCopied] = useState(false);
    const expandable = isExpandable(value);

    // Object.is matches effect dependency changes; !== retains the existing
    // no-flash behavior for signed zeros. The previous effect flashed initial NaN.
    const [flash, setFlash] = useState(() => ({
      value,
      key: typeof value === "number" && Number.isNaN(value) ? 1 : 0,
    }));
    let flashKey = flash.key;
    if (!Object.is(flash.value, value)) {
      flashKey += flash.value !== value ? 1 : 0;
      setFlash({ value, key: flashKey });
    }

    const toggle = () => {
      if (expandable) setExpanded((e) => !e);
    };

    const copy = () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      navigator.clipboard.writeText(toClipboardJson(value)).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
      });
    };

    const entries = expanded && expandable ? entriesOf(value) : [];

    return (
      <div>
        <div className={styles.row}>
          {expandable ? (
            <button
              type="button"
              className={styles.keyToggle}
              onClick={toggle}
              aria-expanded={expanded}
            >
              <span className={styles.caret} aria-hidden="true">
                {expanded ? "▼" : "▶"}
              </span>
              <span className={styles.key}>{name}:</span>
            </button>
          ) : (
            <>
              <span className={styles.caretSpacer} />
              <span className={styles.key}>{name}:</span>
            </>
          )}
          <span
            key={flashKey}
            className={classes(
              styles.value,
              kindClass[kindOf(value)],
              flashKey > 0 && styles.flash
            )}
          >
            {previewOf(value)}
          </span>
          <button
            type="button"
            className={styles.copy}
            onClick={copy}
            aria-label={`Copy ${name}`}
          >
            {copied ? "✓" : "⧉"}
          </button>
        </div>
        {expanded && expandable && (
          <div className={styles.children}>
            {entries.length === 0 && <div className={styles.empty}>empty</div>}
            {entries.slice(0, limit).map((entry) => (
              <TreeNode key={entry.id} name={entry.key} value={entry.value} />
            ))}
            {entries.length > limit && (
              <button
                type="button"
                className={styles.showMore}
                onClick={() => setLimit((l) => l + CHUNK_SIZE)}
              >
                Show{" "}
                {Math.min(CHUNK_SIZE, entries.length - limit).toLocaleString()}{" "}
                more ({(entries.length - limit).toLocaleString()} hidden)
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
);

TreeNode.displayName = "TreeNode";
