import clsx from "clsx";
import { FC } from "react";

import type { JsonChange } from "@tsmono/inspect-common/types";

import { DiffChild, DiffEntry, diffFromChanges } from "./changeDiff";

interface StateDiffViewProps {
  changes: JsonChange[];
  className?: string;
}

/**
 * Renders a view displaying a list of state changes. The diff is built here,
 * not by the event row, so it's only computed while this tab is shown.
 */
export const StateDiffView: FC<StateDiffViewProps> = ({
  changes,
  className,
}) => {
  const diff = diffFromChanges(changes);
  return (
    <div className={clsx(className)}>
      {diff?.kind === "node" ? (
        <div className="jsondiffpatch-delta jsondiffpatch-node jsondiffpatch-child-node-type-object">
          <DiffChildren entry={diff} />
        </div>
      ) : (
        "Unable to render differences"
      )}
    </div>
  );
};

// Markup and class names follow jsondiffpatch's HTML formatter, which the
// theme's `.jsondiffpatch-*` styles (brackets, strike-through) are written for.
const DiffChildren: FC<{
  entry: Extract<DiffEntry, { kind: "node" }>;
}> = ({ entry }) => (
  <ul
    className={clsx(
      "jsondiffpatch-node",
      entry.isArray
        ? "jsondiffpatch-node-type-array"
        : "jsondiffpatch-node-type-object"
    )}
  >
    {entry.children.map((child) => (
      <DiffRow key={child.id} child={child} />
    ))}
  </ul>
);

const DiffRow: FC<{ child: DiffChild }> = ({ child }) => {
  const { entry, key } = child;
  const label = <div className="jsondiffpatch-property-name">{key}</div>;
  switch (entry.kind) {
    case "node":
      return (
        <li
          className={clsx(
            "jsondiffpatch-node",
            entry.isArray
              ? "jsondiffpatch-child-node-type-array"
              : "jsondiffpatch-child-node-type-object"
          )}
          data-key={key}
        >
          {label}
          <DiffChildren entry={entry} />
        </li>
      );
    case "added":
    case "deleted":
      return (
        <li className={`jsondiffpatch-${entry.kind}`} data-key={key}>
          {label}
          <div className="jsondiffpatch-value">
            <DiffValue value={entry.value} />
          </div>
        </li>
      );
    case "modified":
      return (
        <li className="jsondiffpatch-modified" data-key={key}>
          {label}
          <div className="jsondiffpatch-value jsondiffpatch-left-value">
            <DiffValue value={entry.left} />
          </div>
          <div className="jsondiffpatch-value jsondiffpatch-right-value">
            <DiffValue value={entry.right} />
          </div>
        </li>
      );
  }
};

// Escaped newlines inside JSON strings are shown as line breaks.
const DiffValue: FC<{ value: unknown }> = ({ value }) => (
  <pre>
    {value === undefined
      ? "undefined"
      : JSON.stringify(value, null, 2).replace(/\\n/g, "\n")}
  </pre>
);
