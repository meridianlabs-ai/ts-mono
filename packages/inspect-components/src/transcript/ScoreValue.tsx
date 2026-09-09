import clsx from "clsx";
import { FC, ReactNode } from "react";

import type { JsonValue } from "@tsmono/inspect-common/types";
import { MetaDataGrid } from "@tsmono/inspect-components/content";
import { isRecord } from "@tsmono/util";

interface ScoreProps {
  score: JsonValue;
  className?: string | string[];
  maxRows?: number;
  /** When false, raw entries beyond maxRows are hidden with no expand toggle. */
  expandable?: boolean;
}

export const ScoreValue: FC<ScoreProps> = ({
  score,
  className,
  maxRows,
  expandable = true,
}) => (
  <div className={clsx(className)}>
    {renderScore(score, maxRows, expandable)}
  </div>
);

export const renderScore = (
  value: JsonValue,
  maxRows?: number,
  expandable = true
): ReactNode => {
  if (Array.isArray(value)) {
    return value.join(", ");
  } else if (isRecord(value)) {
    if (maxRows != null && !expandable) {
      // Slice raw entries so fixed previews count nested groups without rendering MetaDataGrid's expander.
      const visibleEntries = Object.fromEntries(
        Object.entries(value).slice(0, maxRows)
      );
      return <MetaDataGrid entries={visibleEntries} />;
    }
    return <MetaDataGrid entries={value} maxRows={maxRows} />;
  } else {
    return String(value);
  }
};
