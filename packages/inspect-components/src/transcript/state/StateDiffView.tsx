import clsx from "clsx";
import { diff } from "jsondiffpatch";
import { format } from "jsondiffpatch/formatters/html";
import { FC } from "react";

import { sanitizeRenderedHtml } from "@tsmono/react/components";
import { isRecord } from "@tsmono/util";

interface StateDiffViewProps {
  before: object;
  after: object;
  className?: string;
}

/**
 * Renders a view displaying a list of state changes.
 */
export const StateDiffView: FC<StateDiffViewProps> = ({
  before,
  after,
  className,
}) => {
  // Diff the objects and render the diff
  const state_diff = diff(sanitizeKeys(before), sanitizeKeys(after));

  const html_result = format(state_diff) || "Unable to render differences";
  return (
    <div
      dangerouslySetInnerHTML={{
        // The formatter's output is a string, so unescaping is a string op —
        // the old recursive walk here only ever saw this one call.
        __html: sanitizeRenderedHtml(html_result.replace(/\\n/g, "\n")),
      }}
      className={clsx(className)}
    ></div>
  );
};

/**
 * Escapes angle brackets in object keys so jsondiffpatch's HTML formatter
 * renders them as text. Typed unknown -> unknown: it rebuilds the value rather
 * than preserving its type, which is what the old `<T>(obj: T): T` claimed.
 */
function sanitizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => sanitizeKeys(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key.replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      sanitizeKeys(entry),
    ])
  );
}
