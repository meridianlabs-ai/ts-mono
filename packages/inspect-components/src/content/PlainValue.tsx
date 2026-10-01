import { FC } from "react";

import { ContentText } from "@tsmono/react/components";
import { isRecord } from "@tsmono/util";

import { cappedText } from "./cappedText";
import { MetaDataGrid } from "./MetaDataGrid";
import styles from "./RenderedContent.module.css";
import { RenderedText } from "./RenderedText";

/** Preserves payload values without interpreting strings as structured data. */
export const PlainValue: FC<{
  id: string;
  value: unknown;
  markdown?: boolean;
}> = ({ id, value, markdown = false }) => {
  if (typeof value === "string") {
    if (markdown) return <RenderedText markdown={value} />;
    const { text, notice } = cappedText(value);
    return (
      <>
        <pre className={styles.preWrap}>
          <ContentText text={text} />
        </pre>
        {notice}
      </>
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
