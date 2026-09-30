import { FC } from "react";

import {
  ANSIDisplay,
  ContentText,
  useContentPolicy,
} from "@tsmono/react/components";
import { isAnsiOutput, isRecord } from "@tsmono/util";

import { useDisplayMode } from "./DisplayModeContext";
import { MetaDataGrid } from "./MetaDataGrid";
import styles from "./RenderedContent.module.css";
import { RenderedText } from "./RenderedText";

/** Preserves payload values without interpreting strings as structured data. */
export const PlainValue: FC<{
  id: string;
  value: unknown;
  markdown?: boolean;
}> = ({ id, value, markdown = false }) => {
  const policy = useContentPolicy();
  const displayMode = useDisplayMode();
  if (typeof value === "string") {
    if (policy.ansi && displayMode === "rendered" && isAnsiOutput(value)) {
      return <ANSIDisplay output={value} />;
    }
    return markdown ? (
      <RenderedText markdown={value} />
    ) : (
      <pre className={styles.preWrap}>
        <ContentText text={value} />
      </pre>
    );
  }
  if (Array.isArray(value) && value.length > 0) {
    return (
      <div>
        {value.map((item: unknown, index: number) => (
          <div key={index}>
            <ContentText text={`[${index}]`} />
            <PlainValue
              id={`${id}-${index}`}
              value={item}
              markdown={markdown}
            />
          </div>
        ))}
      </div>
    );
  }
  if (isRecord(value) && Object.keys(value).length > 0) {
    return <MetaDataGrid id={id} entries={value} options={{ plain: true }} />;
  }
  const text =
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    value === undefined
      ? String(value)
      : JSON.stringify(value);
  return (
    <pre className={styles.preWrap}>
      <ContentText text={text} />
    </pre>
  );
};
