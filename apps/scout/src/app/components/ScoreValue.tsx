import clsx from "clsx";
import { FC } from "react";

import type { JsonValue } from "@tsmono/inspect-common/types";
import { MetaDataGrid } from "@tsmono/inspect-components/content";
import { isRecord } from "@tsmono/util";

interface ScoreProps {
  score: JsonValue;
  className?: string | string[];
  maxRows?: number;
  /** When false, rows beyond maxRows are hidden with no expand toggle. */
  expandable?: boolean;
}

export const ScoreValue: FC<ScoreProps> = ({
  score,
  className,
  maxRows,
  expandable = true,
}) => {
  return (
    <div className={clsx(className)}>
      {renderScore(score, maxRows, expandable)}
    </div>
  );
};

export const renderScore = (
  value: JsonValue,
  maxRows?: number,
  expandable = true
) => {
  if (Array.isArray(value)) {
    return value.join(", ");
  } else if (isRecord(value) && typeof value === "object") {
    if (maxRows != null && !expandable) {
      // Pre-slice entries so MetaDataGrid never shows its expand toggle
      const sliced = Object.fromEntries(
        Object.entries(value).slice(0, maxRows)
      );
      return <MetaDataGrid entries={sliced} />;
    }
    return <MetaDataGrid entries={value} maxRows={maxRows} />;
  } else {
    return String(value);
  }
};
